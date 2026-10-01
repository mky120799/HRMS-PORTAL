import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { EmailService } from '../../common/email/email.service';
import { EmailTemplates } from '../../common/email/templates';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { fieldValue, readValidatedFile, RESUME_MIME_TYPES } from '../../common/files/file-validation';
import { paginate, paged } from '../../common/validation/common.schemas';
import { effectivePlan, planMeetsRequirement } from '../../common/subscription/subscription-plans';
import { SlackService } from '../integrations/slack.service';
import { AiService } from '../ai/ai.service';
import { RabbitMqService, HIRING_QUEUE } from '../../common/messaging/rabbitmq.service';
import { HiringWorkflowService } from './hiring-workflow.service';
import { applySchema, type CreateJobDto, type ListApplicationsQuery, type ScheduleInterviewDto, type UpdateJobDto } from './dto/job.dto';
import type { ApplicationStatus } from '../../common/constants/domain';

export { HIRING_QUEUE } from '../../common/messaging/rabbitmq.service';
const RESUME_MAX_BYTES = 5 * 1024 * 1024;
const NOTIFY_CANDIDATE: ApplicationStatus[] = ['SCREENING', 'OFFERED', 'HIRED', 'REJECTED'];

const APPLICATION_FIELDS = {
  id: true, jobId: true, candidateName: true, candidateEmail: true, resumeFilename: true, status: true,
  source: true,
  aiScore: true, aiReason: true, aiScoredAt: true, interviewAt: true, interviewerEmail: true, createdAt: true, updatedAt: true,
  job: { select: { id: true, title: true, department: true } },
  stage: { select: { id: true, key: true, name: true, category: true, position: true } },
} satisfies Prisma.ApplicationSelect;

function googleCalendarUrl(title: string, start: Date, end: Date, details: string, location?: string) {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(start)}/${f(end)}`, details, ...(location ? { location } : {}) });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

@Injectable()
export class HiringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly slack: SlackService,
    private readonly ai: AiService,
    private readonly rabbit: RabbitMqService,
    private readonly workflow: HiringWorkflowService,
  ) {}

  // ─── Public careers site ────────────────────────────────────────────────────

  /** Public listing for ONE company, addressed by its slug. Never exposes tenant ids. */
  async careers(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: slug.toLowerCase() }, select: { id: true, name: true, isActive: true } });
    if (!tenant || !tenant.isActive) throw new NotFoundException('Careers page not found');
    const jobs = await this.prisma.job.findMany({
      where: { tenantId: tenant.id, status: 'OPEN' },
      select: { id: true, title: true, department: true, location: true, description: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { company: tenant.name, jobs };
  }

  async apply(slug: string, jobId: string, part: MultipartFile | undefined) {
    const file = await readValidatedFile(part, { allowed: RESUME_MIME_TYPES, maxBytes: RESUME_MAX_BYTES });
    const parsed = applySchema.safeParse({
      candidateName: fieldValue(part!, 'candidateName'),
      candidateEmail: fieldValue(part!, 'candidateEmail'),
      consent: fieldValue(part!, 'consent'),
      source: fieldValue(part!, 'source'),
    });
    if (!parsed.success) throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });

    const job = await this.prisma.job.findFirst({
      where: { id: jobId, status: 'OPEN', tenant: { slug: slug.toLowerCase(), isActive: true } },
      include: { tenant: { select: { id: true, name: true, subscriptionPlan: true, subscriptionStatus: true, trialEndsAt: true } } },
    });
    if (!job) throw new NotFoundException('This position is no longer open');
    const initialStage = await this.workflow.defaultStage(job.tenantId);

    const key = StorageService.tenantKey(job.tenantId, 'resumes', job.id, `${randomUUID()}.${file.ext}`);
    await this.storage.put(key, file.buffer, file.mime);

    let application;
    try {
      application = await this.prisma.application.create({
        data: {
          tenantId: job.tenantId,
          jobId: job.id,
          candidateName: parsed.data.candidateName,
          candidateEmail: parsed.data.candidateEmail,
          resumeFilename: file.originalName,
          resumeKey: key,
          resumeMimeType: file.mime,
          source: parsed.data.source ?? 'CAREERS_SITE',
          status: 'APPLIED',
          stageId: initialStage.id,
          events: { create: { tenantId: job.tenantId, type: 'APPLICATION_SUBMITTED', metadata: { stageId: initialStage.id, stageName: initialStage.name, source: parsed.data.source ?? 'CAREERS_SITE' } } },
        },
        select: { id: true },
      });
    } catch (e) {
      await this.storage.delete(key);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You have already applied for this position');
      throw e;
    }

    if (this.ai.enabled && planMeetsRequirement(effectivePlan(job.tenant), 'ENTERPRISE')) {
      await this.rabbit.publish(HIRING_QUEUE, 'screen', { applicationId: application.id, tenantId: job.tenantId });
    }
    await this.email.send({
      tenantId: job.tenantId,
      to: parsed.data.candidateEmail,
      email: EmailTemplates.applicationReceived({ candidateName: parsed.data.candidateName, jobTitle: job.title, companyName: job.tenant.name }),
    });
    void this.slack.newApplication(job.tenantId, { jobTitle: job.title, candidateName: parsed.data.candidateName });
    return { applied: true, applicationId: application.id };
  }

  // ─── Jobs ───────────────────────────────────────────────────────────────────

  jobs(tenantId: string) {
    return this.prisma.job.findMany({ where: { tenantId }, include: { _count: { select: { applications: true } } }, orderBy: { createdAt: 'desc' } });
  }

  createJob(tenantId: string, dto: CreateJobDto) {
    return this.prisma.job.create({ data: { ...dto, tenantId, status: 'OPEN' } });
  }

  async updateJob(tenantId: string, id: string, dto: UpdateJobDto) {
    const { count } = await this.prisma.job.updateMany({ where: { id, tenantId }, data: dto });
    if (!count) throw new NotFoundException('Job not found');
    return this.prisma.job.findUniqueOrThrow({ where: { id } });
  }

  // ─── Applications ───────────────────────────────────────────────────────────

  async applications(tenantId: string, q: ListApplicationsQuery) {
    const where: Prisma.ApplicationWhereInput = {
      tenantId,
      ...(q.jobId ? { jobId: q.jobId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.source ? { source: q.source } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.application.findMany({ where, select: APPLICATION_FIELDS, orderBy: [{ createdAt: 'desc' }], ...paginate(q) }),
      this.prisma.application.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async resume(tenantId: string, id: string) {
    const app = await this.findApplication(tenantId, id);
    if (!app.resumeKey) throw new NotFoundException('No resume on file');
    return {
      stream: await this.storage.getStream(app.resumeKey),
      mimeType: app.resumeMimeType ?? 'application/octet-stream',
      filename: (app.resumeFilename ?? 'resume').replace(/[^\w.-]+/g, '_'),
    };
  }

  async updateStatus(user: AuthUser, id: string, status: ApplicationStatus) {
    const app = await this.findApplication(user.tenantId, id);
    if (app.status === status) return this.prisma.application.findUniqueOrThrow({ where: { id }, select: APPLICATION_FIELDS });
    const updated = await this.workflow.moveToCategory(user, id, status);

    if (NOTIFY_CANDIDATE.includes(status)) {
      await this.email.send({
        tenantId: user.tenantId,
        to: app.candidateEmail,
        email: EmailTemplates.applicationStatus({ candidateName: app.candidateName, jobTitle: app.job.title, companyName: app.tenant.name, status }),
      });
    }
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'APPLICATION_STATUS', resource: 'hiring', resourceId: id, oldValues: { status: app.status }, newValues: { status } });
    return updated;
  }

  /**
   * Records the interview and emails candidate + interviewer an "add to calendar" link.
   * When `dto.isReschedule` is true, sends a "rescheduled" email variant instead.
   * No shared Google account is involved — no stored OAuth token to leak.
   */
  async scheduleInterview(user: AuthUser, id: string, dto: ScheduleInterviewDto) {
    const app = await this.findApplication(user.tenantId, id);
    const interviewerEmail = dto.interviewerEmail ?? user.email;
    const interviewer = await this.prisma.user.findUnique({ where: { tenantId_email: { tenantId: user.tenantId, email: interviewerEmail } } });
    if (!interviewer || !interviewer.isActive) throw new BadRequestException('The interviewer must be an active user in your workspace');

    const start = new Date(dto.startsAt);
    if (start.getTime() < Date.now()) throw new BadRequestException('Interview time must be in the future');
    const end = new Date(start.getTime() + dto.durationMinutes * 60_000);

    if (app.status !== 'INTERVIEW') await this.workflow.moveToCategory(user, id, 'INTERVIEW');
    const updated = await this.prisma.application.update({
      where: { id },
      data: { status: 'INTERVIEW', interviewAt: start, interviewerEmail, interviewReminderSentAt: null },
      select: APPLICATION_FIELDS,
    });
    const eventType = dto.isReschedule ? 'INTERVIEW_RESCHEDULED' : 'INTERVIEW_SCHEDULED';
    await this.prisma.applicationEvent.create({
      data: {
        tenantId: user.tenantId,
        applicationId: id,
        actorUserId: user.userId,
        type: eventType,
        metadata: { startsAt: start.toISOString(), durationMinutes: dto.durationMinutes, interviewerEmail, location: dto.location ?? null, isReschedule: dto.isReschedule },
      },
    });

    const title = `Interview: ${app.candidateName} — ${app.job.title}`;
    const calendarUrl = googleCalendarUrl(title, start, end, `Interview for ${app.job.title} at ${app.tenant.name}.`, dto.location);
    const when = `${start.toUTCString()} (${dto.durationMinutes} min)`;
    const common = { candidateName: app.candidateName, jobTitle: app.job.title, companyName: app.tenant.name, when, calendarUrl, location: dto.location };

    const template = dto.isReschedule ? EmailTemplates.interviewRescheduled : EmailTemplates.interviewScheduled;
    await this.email.send({ tenantId: user.tenantId, to: app.candidateEmail, email: template({ ...common, recipientName: app.candidateName }) });
    await this.email.send({ tenantId: user.tenantId, to: interviewerEmail, recipientUserId: interviewer.id, email: template({ ...common, recipientName: interviewer.name }) });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: eventType, resource: 'hiring', resourceId: id, newValues: { startsAt: start.toISOString(), durationMinutes: dto.durationMinutes, interviewerEmail } });
    return { ...updated, calendarUrl };
  }

  async rescreen(user: AuthUser, id: string) {
    await this.findApplication(user.tenantId, id);
    if (!this.ai.enabled) throw new BadRequestException('AI screening is not configured');
    await this.rabbit.publish(HIRING_QUEUE, 'screen', { applicationId: id, tenantId: user.tenantId });
    return { queued: true };
  }

  private async findApplication(tenantId: string, id: string) {
    const app = await this.prisma.application.findFirst({ where: { id, tenantId }, include: { job: true, tenant: { select: { name: true } }, stage: true } });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { EmailTemplates } from '../../common/email/templates';
import type { AuthUser } from '../../common/auth/auth-user';
import { fieldValue, readValidatedFile, RESUME_MIME_TYPES } from '../../common/files/file-validation';
import { paginate, paged } from '../../common/validation/common.schemas';
import { effectivePlan, planMeetsRequirement } from '../../common/subscription/subscription-plans';
import { AiService } from '../ai/ai.service';
import { HiringWorkflowService } from './hiring-workflow.service';
import { applySchema, type CreateJobDto, type ListApplicationsQuery, type ScheduleInterviewDto, type UpdateJobDto } from './dto/job.dto';
import type { ApplicationStatus } from '../../common/constants/domain';
import { HiringOutboxService } from './hiring-outbox.service';
import { HiringInterviewService } from './hiring-interview.service';

export { HIRING_QUEUE } from '../../common/messaging/rabbitmq.service';
const RESUME_MAX_BYTES = 5 * 1024 * 1024;

const APPLICATION_FIELDS = {
  id: true, jobId: true, candidateName: true, candidateEmail: true, resumeFilename: true, status: true,
  source: true,
  aiScore: true, aiReason: true, aiScoredAt: true, interviewAt: true, interviewerEmail: true,
  interviewDurationMinutes: true, interviewLocation: true, createdAt: true, updatedAt: true,
  job: { select: { id: true, title: true, department: true } },
  stage: { select: { id: true, key: true, name: true, category: true, position: true } },
} satisfies Prisma.ApplicationSelect;

@Injectable()
export class HiringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiService,
    private readonly workflow: HiringWorkflowService,
    private readonly outbox: HiringOutboxService,
    private readonly interviews: HiringInterviewService,
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
      application = await this.prisma.$transaction(async (tx) => {
        const created = await tx.application.create({
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
        await this.outbox.enqueueEmail(tx, {
          tenantId: job.tenantId,
          applicationId: created.id,
          eventKey: `application-received:${created.id}`,
          to: parsed.data.candidateEmail,
          email: EmailTemplates.applicationReceived({ candidateName: parsed.data.candidateName, jobTitle: job.title, companyName: job.tenant.name }),
        });
        await this.outbox.enqueueSlackApplication(tx, {
          tenantId: job.tenantId,
          applicationId: created.id,
          eventKey: `new-application:${created.id}`,
          jobTitle: job.title,
          candidateName: parsed.data.candidateName,
        });
        if (this.ai.enabled && planMeetsRequirement(effectivePlan(job.tenant), 'ENTERPRISE')) {
          await this.outbox.enqueueHiringJob(tx, {
            tenantId: job.tenantId,
            applicationId: created.id,
            eventKey: `ai-screening:${created.id}:initial`,
            jobType: 'screen',
            payload: { applicationId: created.id, tenantId: job.tenantId },
          });
        }
        return created;
      });
    } catch (e) {
      await this.storage.delete(key);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You have already applied for this position');
      throw e;
    }

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
    return this.workflow.moveToCategory(user, id, status);
  }

  /**
   * Records the interview and emails candidate + interviewer an "add to calendar" link.
   * When `dto.isReschedule` is true, sends a "rescheduled" email variant instead.
   * No shared Google account is involved — no stored OAuth token to leak.
   */
  async scheduleInterview(user: AuthUser, id: string, dto: ScheduleInterviewDto) {
    return this.interviews.schedule(user, id, dto);
  }

  async rescreen(user: AuthUser, id: string) {
    await this.findApplication(user.tenantId, id);
    if (!this.ai.enabled) throw new BadRequestException('AI screening is not configured');
    await this.prisma.$transaction(async (tx) => {
      const event = await tx.applicationEvent.create({ data: { tenantId: user.tenantId, applicationId: id, actorUserId: user.userId, type: 'AI_RESCREEN_REQUESTED' } });
      await tx.auditLog.create({ data: { tenantId: user.tenantId, userId: user.userId, action: 'AI_RESCREEN_REQUESTED', resource: 'hiring', resourceId: id } });
      await this.outbox.enqueueHiringJob(tx, {
        tenantId: user.tenantId,
        applicationId: id,
        eventKey: `ai-rescreen:${event.id}`,
        jobType: 'screen',
        payload: { applicationId: id, tenantId: user.tenantId },
      });
    });
    return { queued: true };
  }

  private async findApplication(tenantId: string, id: string) {
    const app = await this.prisma.application.findFirst({ where: { id, tenantId }, include: { job: true, tenant: { select: { name: true } }, stage: true } });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }
}

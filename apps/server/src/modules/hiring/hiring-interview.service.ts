import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user';
import { EmailTemplates } from '../../common/email/templates';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScheduleInterviewDto } from './dto/job.dto';
import { HiringOutboxService } from './hiring-outbox.service';
import { HiringWorkflowService } from './hiring-workflow.service';

function googleCalendarUrl(title: string, start: Date, end: Date, details: string, location?: string) {
  const format = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${format(start)}/${format(end)}`, details, ...(location ? { location } : {}) });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

@Injectable()
export class HiringInterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: HiringWorkflowService,
    private readonly outbox: HiringOutboxService,
  ) {}

  async schedule(user: AuthUser, applicationId: string, dto: ScheduleInterviewDto) {
    const [application, interviewer, interviewStage] = await Promise.all([
      this.prisma.application.findFirst({ where: { id: applicationId, tenantId: user.tenantId }, include: { job: true, tenant: { select: { name: true } }, stage: true } }),
      this.prisma.user.findUnique({ where: { tenantId_email: { tenantId: user.tenantId, email: dto.interviewerEmail ?? user.email } } }),
      this.workflow.defaultStage(user.tenantId, 'INTERVIEW'),
    ]);
    if (!application) throw new NotFoundException('Application not found');
    if (!interviewer?.isActive) throw new BadRequestException('The interviewer must be an active user in your workspace');
    if (!['APPLIED', 'SCREENING', 'INTERVIEW'].includes(application.status)) throw new ConflictException(`Cannot schedule an interview while the application is ${application.status.toLowerCase()}`);

    const start = new Date(dto.startsAt);
    if (start.getTime() < Date.now()) throw new BadRequestException('Interview time must be in the future');
    const end = new Date(start.getTime() + dto.durationMinutes * 60_000);
    const isReschedule = dto.isReschedule || Boolean(application.interviewAt);
    const eventType = isReschedule ? 'INTERVIEW_RESCHEDULED' : 'INTERVIEW_SCHEDULED';
    const calendarUrl = googleCalendarUrl(`Interview: ${application.candidateName} — ${application.job.title}`, start, end, `Interview for ${application.job.title} at ${application.tenant.name}.`, dto.location);
    const common = { candidateName: application.candidateName, jobTitle: application.job.title, companyName: application.tenant.name, when: `${start.toUTCString()} (${dto.durationMinutes} min)`, calendarUrl, location: dto.location };
    const template = isReschedule ? EmailTemplates.interviewRescheduled : EmailTemplates.interviewScheduled;

    const updated = await this.prisma.$transaction(async (tx) => {
      const version = application.interviewScheduleVersion + 1;
      const changed = await tx.application.updateMany({
        where: { id: applicationId, tenantId: user.tenantId, status: application.status, stageId: application.stageId, interviewScheduleVersion: application.interviewScheduleVersion },
        data: {
          status: 'INTERVIEW',
          stageId: application.status === 'INTERVIEW' ? application.stageId : interviewStage.id,
          interviewAt: start,
          interviewerEmail: interviewer.email,
          interviewDurationMinutes: dto.durationMinutes,
          interviewLocation: dto.location ?? null,
          interviewScheduleVersion: version,
          interviewReminderSentAt: null,
        },
      });
      if (!changed.count) throw new ConflictException('This application changed before the interview could be scheduled');
      if (application.status !== 'INTERVIEW') {
        await tx.applicationEvent.create({
          data: { tenantId: user.tenantId, applicationId, actorUserId: user.userId, type: 'STAGE_CHANGED', metadata: { fromStatus: application.status, fromStageId: application.stageId, fromStageName: application.stage?.name ?? null, toStatus: 'INTERVIEW', toStageId: interviewStage.id, toStageName: interviewStage.name } },
        });
      }
      const event = await tx.applicationEvent.create({
        data: { tenantId: user.tenantId, applicationId, actorUserId: user.userId, type: eventType, metadata: { startsAt: start.toISOString(), durationMinutes: dto.durationMinutes, interviewerEmail: interviewer.email, location: dto.location ?? null, interviewScheduleVersion: version } },
      });
      await tx.auditLog.create({ data: { tenantId: user.tenantId, userId: user.userId, action: eventType, resource: 'hiring', resourceId: applicationId, newValues: { startsAt: start.toISOString(), durationMinutes: dto.durationMinutes, interviewerEmail: interviewer.email, location: dto.location ?? null } } });
      await this.outbox.enqueueEmail(tx, { tenantId: user.tenantId, applicationId, eventKey: `${eventType.toLowerCase()}:${event.id}:candidate`, eventType, to: application.candidateEmail, email: template({ ...common, recipientName: application.candidateName }) });
      await this.outbox.enqueueEmail(tx, { tenantId: user.tenantId, applicationId, eventKey: `${eventType.toLowerCase()}:${event.id}:interviewer`, eventType, to: interviewer.email, recipientUserId: interviewer.id, email: template({ ...common, recipientName: interviewer.name }) });
      return tx.application.findUniqueOrThrow({ where: { id: applicationId }, include: { job: { select: { id: true, title: true, department: true } }, stage: true } });
    });
    return { ...updated, calendarUrl };
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailTemplates } from '../../common/email/templates';
import { HiringOutboxService } from './hiring-outbox.service';

const REMINDER_WINDOW_MS = 24 * 60 * 60_000;
const REMINDER_INTERVAL_MS = 60 * 60_000;

function googleCalendarUrl(title: string, start: Date, end: Date, details: string, location?: string | null) {
  const format = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${format(start)}/${format(end)}`, details, ...(location ? { location } : {}) });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Lifecycle-aware, multi-instance-safe interview reminder scheduler. */
@Injectable()
export class HiringScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HiringScheduler.name);
  private initialTimer?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: HiringOutboxService,
  ) {}

  onModuleInit() {
    this.initialTimer = setTimeout(() => void this.queueInterviewReminders(), 30_000);
    this.initialTimer.unref();
    this.interval = setInterval(() => void this.queueInterviewReminders(), REMINDER_INTERVAL_MS);
    this.interval.unref();
  }

  onModuleDestroy() {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.interval) clearInterval(this.interval);
  }

  async queueInterviewReminders() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);
      const applications = await this.prisma.application.findMany({
        where: { status: 'INTERVIEW', interviewAt: { gte: now, lte: windowEnd }, interviewReminderSentAt: null },
        include: { job: { select: { title: true } }, tenant: { select: { name: true } } },
      });
      for (const application of applications) await this.queueOne(application, now);
    } finally {
      this.running = false;
    }
  }

  private async queueOne(application: Awaited<ReturnType<typeof this.findApplicationShape>>, queuedAt: Date) {
    if (!application.interviewAt) return;
    const interviewAt = application.interviewAt;
    const interviewer = application.interviewerEmail
      ? await this.prisma.user.findUnique({ where: { tenantId_email: { tenantId: application.tenantId, email: application.interviewerEmail } }, select: { id: true, name: true, email: true, isActive: true } })
      : null;
    const durationMinutes = application.interviewDurationMinutes ?? 45;
    const end = new Date(interviewAt.getTime() + durationMinutes * 60_000);
    const calendarUrl = googleCalendarUrl(`Interview: ${application.candidateName} — ${application.job.title}`, interviewAt, end, `Interview for ${application.job.title} at ${application.tenant.name}.`, application.interviewLocation);
    const common = { candidateName: application.candidateName, jobTitle: application.job.title, companyName: application.tenant.name, when: interviewAt.toUTCString(), calendarUrl, location: application.interviewLocation ?? undefined };
    const eventPrefix = `interview-reminder:${application.id}:v${application.interviewScheduleVersion}`;

    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.application.updateMany({
          where: { id: application.id, interviewAt, interviewScheduleVersion: application.interviewScheduleVersion, interviewReminderSentAt: null },
          data: { interviewReminderSentAt: queuedAt },
        });
        if (!claimed.count) return;
        await this.outbox.enqueueEmail(tx, {
          tenantId: application.tenantId,
          applicationId: application.id,
          eventKey: `${eventPrefix}:candidate`,
          to: application.candidateEmail,
          email: EmailTemplates.interviewReminder({ ...common, recipientName: application.candidateName }),
        });
        if (interviewer?.isActive && interviewer.email !== application.candidateEmail) {
          await this.outbox.enqueueEmail(tx, {
            tenantId: application.tenantId,
            applicationId: application.id,
            eventKey: `${eventPrefix}:interviewer`,
            to: interviewer.email,
            recipientUserId: interviewer.id,
            email: EmailTemplates.interviewReminder({ ...common, recipientName: interviewer.name }),
          });
        }
        await tx.applicationEvent.create({
          data: { tenantId: application.tenantId, applicationId: application.id, type: 'INTERVIEW_REMINDER_QUEUED', metadata: { scheduledAt: interviewAt.toISOString(), queuedAt: queuedAt.toISOString(), interviewScheduleVersion: application.interviewScheduleVersion } },
        });
      });
    } catch (error) {
      this.logger.error(`Failed to queue interview reminder for ${application.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Type-only helper; never called. */
  private findApplicationShape() {
    return this.prisma.application.findFirstOrThrow({ include: { job: { select: { title: true } }, tenant: { select: { name: true } } } });
  }
}

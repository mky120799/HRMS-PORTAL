import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AiService } from '../ai/ai.service';
import { HIRING_QUEUE } from './hiring.service';
import { RabbitMqService } from '../../common/messaging/rabbitmq.service';
import { EmailService } from '../../common/email/email.service';
import { EmailTemplates } from '../../common/email/templates';

// Send the reminder when the interview is within this window (24 h ± cron drift)
const REMINDER_WINDOW_MS = 24 * 60 * 60_000;
// Run the reminder sweep every hour
const REMINDER_INTERVAL_MS = 60 * 60_000;

function googleCalendarUrl(title: string, start: Date, end: Date, details: string, location?: string | null) {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(start)}/${f(end)}`, details, ...(location ? { location } : {}) });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Background workers for the hiring queue:
 *  1. Resume AI screening — triggered per application via RabbitMQ.
 *  2. Interview reminder sweep — runs on an hourly interval to send 24-h
 *     pre-interview reminder emails to candidates and interviewers.
 */
@Injectable()
export class HiringProcessor implements OnModuleInit {
  private readonly logger = new Logger(HiringProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiService,
    private readonly rabbit: RabbitMqService,
    private readonly email: EmailService,
  ) {}

  async onModuleInit() {
    // AI screening consumer
    await this.rabbit.consume<{ applicationId: string; tenantId: string }>(
      HIRING_QUEUE,
      (message) => this.process(message.payload),
      { concurrency: 2, attempts: 3, retryDelayMs: 60_000 },
    );

    // Interview reminder sweep — start after 30 s then repeat hourly
    setTimeout(() => {
      void this.sendInterviewReminders();
      setInterval(() => void this.sendInterviewReminders(), REMINDER_INTERVAL_MS);
    }, 30_000);
  }

  // ─── AI resume screening ────────────────────────────────────────────────────

  async process(job: { applicationId: string; tenantId: string }): Promise<void> {
    const app = await this.prisma.application.findFirst({
      where: { id: job.applicationId, tenantId: job.tenantId },
      include: { job: true },
    });
    if (!app?.resumeKey) return;

    const text = await this.ai.extractText(await this.storage.getBuffer(app.resumeKey), app.resumeMimeType ?? '');
    if (text.length < 100) {
      await this.prisma.application.update({
        where: { id: app.id },
        data: {
          aiScore: null,
          aiReason: 'Automatic screening skipped: resume text could not be read (non-PDF or scanned document). Review manually.',
          aiScoredAt: new Date(),
        },
      });
      return;
    }

    const result = await this.ai.screenResume(app.job, text);
    const reason = [result.summary, result.strengths.length ? `Strengths: ${result.strengths.join('; ')}` : '', result.gaps.length ? `Gaps: ${result.gaps.join('; ')}` : '']
      .filter(Boolean)
      .join('\n');
    await this.prisma.application.update({ where: { id: app.id }, data: { aiScore: result.score, aiReason: reason, aiScoredAt: new Date() } });
    this.logger.log(`Screened application ${app.id}: ${result.score}`);
  }

  // ─── Interview reminder sweep ───────────────────────────────────────────────

  /**
   * Finds interviews scheduled within the next 24 hours that have not yet had
   * a reminder sent, sends emails to both candidate and interviewer, and marks
   * `interviewReminderSentAt` so the sweep is idempotent across retries.
   */
  async sendInterviewReminders(): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);

    const applications = await this.prisma.application.findMany({
      where: {
        status: 'INTERVIEW',
        interviewAt: { gte: now, lte: windowEnd },
        interviewReminderSentAt: null,
      },
      include: {
        job: { select: { title: true } },
        tenant: { select: { id: true, name: true } },
      },
    });

    if (!applications.length) return;
    this.logger.log(`Sending interview reminders for ${applications.length} upcoming interview(s)`);

    for (const app of applications) {
      try {
        if (!app.interviewAt) continue;

        // We don't persist duration, so estimate a 45-minute block for the calendar link
        const start = app.interviewAt;
        const end = new Date(start.getTime() + 45 * 60_000);
        const title = `Interview: ${app.candidateName} — ${app.job.title}`;
        const calendarUrl = googleCalendarUrl(title, start, end, `Interview for ${app.job.title} at ${app.tenant.name}.`);
        const when = start.toUTCString();
        const common = { candidateName: app.candidateName, jobTitle: app.job.title, companyName: app.tenant.name, when, calendarUrl };

        // Email candidate
        await this.email.send({
          tenantId: app.tenantId,
          to: app.candidateEmail,
          email: EmailTemplates.interviewReminder({ ...common, recipientName: app.candidateName }),
        });

        // Email interviewer if known and different from candidate
        if (app.interviewerEmail && app.interviewerEmail !== app.candidateEmail) {
          const interviewer = await this.prisma.user.findUnique({
            where: { tenantId_email: { tenantId: app.tenantId, email: app.interviewerEmail } },
            select: { id: true, name: true, isActive: true },
          });
          if (interviewer?.isActive) {
            await this.email.send({
              tenantId: app.tenantId,
              to: app.interviewerEmail,
              recipientUserId: interviewer.id,
              email: EmailTemplates.interviewReminder({ ...common, recipientName: interviewer.name }),
            });
          }
        }

        // Mark sent — use updateMany to silently skip if another process beat us
        await this.prisma.application.updateMany({
          where: { id: app.id, interviewReminderSentAt: null },
          data: { interviewReminderSentAt: now },
        });

        // Log in the application timeline
        await this.prisma.applicationEvent.create({
          data: {
            tenantId: app.tenantId,
            applicationId: app.id,
            type: 'INTERVIEW_REMINDER_SENT',
            metadata: { scheduledAt: start.toISOString(), sentAt: now.toISOString() },
          },
        });
      } catch (err: any) {
        this.logger.error(`Failed to send interview reminder for application ${app.id}: ${err.message}`);
      }
    }
  }
}

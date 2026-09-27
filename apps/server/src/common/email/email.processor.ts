import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_QUEUE, EmailJob } from './email.service';

/**
 * Delivers queued emails. Throws on failure so BullMQ retries with exponential
 * backoff; the Notification row reflects the real outcome (SENT / FAILED)
 * rather than optimistically claiming success.
 */
@Processor(EMAIL_QUEUE, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly ses?: SESClient;
  private readonly from: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    super();
    this.from = config.get('EMAIL_FROM', 'HRMS <noreply@example.com>');
    if (config.get('EMAIL_DRIVER') === 'ses') this.ses = new SESClient({ region: config.get('AWS_REGION') });
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const { notificationId, to, subject, html, text } = job.data;
    try {
      if (this.ses) {
        await this.ses.send(
          new SendEmailCommand({
            Source: this.from,
            Destination: { ToAddresses: [to] },
            Message: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Html: { Data: html, Charset: 'UTF-8' }, Text: { Data: text, Charset: 'UTF-8' } },
            },
          }),
        );
      } else {
        this.logger.log(`[email:log-driver] to=${to} subject="${subject}"\n${text}`);
      }
      await this.prisma.notification.update({ where: { id: notificationId }, data: { status: 'SENT', sentAt: new Date(), error: null } });
    } catch (err: any) {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.warn(`Email ${notificationId} attempt ${job.attemptsMade + 1} failed: ${err.message}`);
      await this.prisma.notification
        .update({ where: { id: notificationId }, data: { status: finalAttempt ? 'FAILED' : 'QUEUED', error: String(err.message).slice(0, 500) } })
        .catch(() => undefined);
      throw err;
    }
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_QUEUE, EmailJob } from './email.service';
import { RabbitMqService } from '../messaging/rabbitmq.service';

/**
 * Delivers queued emails. Throws on failure so RabbitMQ retries with exponential
 * backoff; the Notification row reflects the real outcome (SENT / FAILED)
 * rather than optimistically claiming success.
 */
@Injectable()
export class EmailProcessor implements OnModuleInit {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly ses?: SESClient;
  private readonly from: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMqService,
    config: ConfigService,
  ) {
    this.from = config.get('EMAIL_FROM', 'HRMS <noreply@example.com>');
    if (config.get('EMAIL_DRIVER') === 'ses') this.ses = new SESClient({ region: config.get('AWS_REGION') });
  }

  async onModuleInit() {
    await this.rabbit.consume<EmailJob>(EMAIL_QUEUE, (message) => this.process(message.payload, message.attempt), { concurrency: 5, attempts: 5, retryDelayMs: 30_000 });
  }

  async process({ notificationId, to, subject, html, text }: EmailJob, attempt: number): Promise<void> {
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
      this.logger.warn(`Email ${notificationId} attempt ${attempt + 1} failed: ${err.message}`);
      await this.prisma.notification
        .update({ where: { id: notificationId }, data: { status: 'QUEUED', error: String(err.message).slice(0, 500) } })
        .catch(() => undefined);
      throw err;
    }
  }
}

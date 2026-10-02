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
    if (config.get('EMAIL_DRIVER') === 'ses')
      this.ses = new SESClient({ region: config.get('AWS_REGION') });
  }

  async onModuleInit() {
    await this.rabbit.consume<EmailJob>(
      EMAIL_QUEUE,
      (message) => this.process(message.payload, message.attempt),
      { concurrency: 5, attempts: 5, retryDelayMs: 30_000 },
    );
  }

  async process(
    { notificationId, to, subject, html, text }: EmailJob,
    attempt: number,
  ): Promise<void> {
    const now = new Date();
    const staleLease = new Date(now.getTime() - 5 * 60_000);
    const claimed = await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        OR: [
          { status: 'QUEUED' },
          { status: 'PROCESSING', processingAt: { lt: staleLease } },
        ],
      },
      data: { status: 'PROCESSING', processingAt: now },
    });
    if (!claimed.count) {
      const existing = await this.prisma.notification.findUnique({
        where: { id: notificationId },
        select: { status: true },
      });
      if (!existing || existing.status === 'SENT') return;
      throw new Error(
        `Email notification ${notificationId} is already being processed`,
      );
    }
    try {
      if (this.ses) {
        await this.ses.send(
          new SendEmailCommand({
            Source: this.from,
            Destination: { ToAddresses: [to] },
            Message: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: html, Charset: 'UTF-8' },
                Text: { Data: text, Charset: 'UTF-8' },
              },
            },
          }),
        );
      } else {
        this.logger.log(
          `[email:log-driver] to=${to} subject="${subject}"\n${text}`,
        );
      }
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          processingAt: null,
          error: null,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const terminal = attempt + 1 >= 5;
      this.logger.warn(
        `Email ${notificationId} attempt ${attempt + 1} failed: ${message}`,
      );
      await this.prisma.notification
        .update({
          where: { id: notificationId },
          data: {
            status: terminal ? 'FAILED' : 'QUEUED',
            processingAt: null,
            error: message.slice(0, 500),
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }
}

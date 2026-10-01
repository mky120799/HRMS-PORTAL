import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RenderedEmail } from './templates';
import { RabbitMqService, EMAIL_QUEUE } from '../messaging/rabbitmq.service';

export { EMAIL_QUEUE } from '../messaging/rabbitmq.service';

export interface EmailJob {
  notificationId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Emails are recorded in the Notification table, then delivered asynchronously
 * by EmailProcessor with retries. The HTTP request never waits on SES.
 *
 * `sensitive: true` (invite / reset links) stores a redacted body so that
 * credential links cannot be read back from the notification log.
 */
@Injectable()
export class EmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMqService,
  ) {}

  async send(params: { tenantId: string; to: string; email: RenderedEmail; recipientUserId?: string | null; sensitive?: boolean }) {
    const notification = await this.prisma.notification.create({
      data: {
        tenantId: params.tenantId,
        channel: 'EMAIL',
        title: params.email.subject,
        subject: params.email.subject,
        body: params.sensitive ? '[redacted: contains a one-time credential link]' : params.email.html,
        recipientEmail: params.to,
        recipientUserId: params.recipientUserId ?? null,
        status: 'QUEUED',
      },
    });

    await this.rabbit.publish(EMAIL_QUEUE, 'send', { notificationId: notification.id, to: params.to, subject: params.email.subject, html: params.email.html, text: params.email.text });
    return notification;
  }
}

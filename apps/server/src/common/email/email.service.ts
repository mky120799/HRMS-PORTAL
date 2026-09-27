import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import type { RenderedEmail } from './templates';

export const EMAIL_QUEUE = 'email';

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
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJob>,
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

    await this.queue.add(
      'send',
      { notificationId: notification.id, to: params.to, subject: params.email.subject, html: params.email.html, text: params.email.text },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true, // do not retain credential links in Redis
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return notification;
  }
}

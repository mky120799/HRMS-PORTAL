import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import type { EmailJob } from '../../common/email/email.service';
import {
  EMAIL_QUEUE,
  RabbitMqService,
} from '../../common/messaging/rabbitmq.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

const POLL_MS = 2_000;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

/** Moves committed notification work from PostgreSQL to RabbitMQ. */
@Injectable()
export class NotificationOutboxProcessor
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationOutboxProcessor.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMqService,
    private readonly crypto: CryptoService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.scheduleDrain(), POLL_MS);
    this.timer.unref();
    this.scheduleDrain();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private scheduleDrain() {
    void this.drain().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Notification outbox drain failed: ${message}`);
      Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        { tags: { component: 'notification-outbox-drain' } },
      );
    });
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const leaseExpired = new Date(now.getTime() - LEASE_MS);
      const events = await this.prisma.notificationOutboxEvent.findMany({
        where: {
          availableAt: { lte: now },
          OR: [
            { status: 'PENDING' },
            { status: 'PROCESSING', lockedAt: { lt: leaseExpired } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 25,
      });

      for (const event of events) {
        const claimed = await this.prisma.notificationOutboxEvent.updateMany({
          where: {
            id: event.id,
            availableAt: { lte: now },
            OR: [
              { status: 'PENDING' },
              { status: 'PROCESSING', lockedAt: { lt: leaseExpired } },
            ],
          },
          data: { status: 'PROCESSING', lockedAt: now },
        });
        if (!claimed.count) continue;
        await this.deliver(event).catch((error: unknown) =>
          this.fail(event, error),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async deliver(event: {
    id: string;
    type: string;
    payload: Prisma.JsonValue;
    encryptedPayload: string | null;
  }) {
    if (event.type !== 'EMAIL') {
      throw new Error(`Unsupported notification outbox type ${event.type}`);
    }
    const payload = this.emailPayload(event.payload, event.encryptedPayload);
    await this.rabbit.publish<EmailJob>(EMAIL_QUEUE, 'send', payload);
    await this.prisma.notificationOutboxEvent.update({
      where: { id: event.id },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });
  }

  private async fail(
    event: {
      id: string;
      attempts: number;
      payload: Prisma.JsonValue;
    },
    error: unknown,
  ) {
    const attempts = event.attempts + 1;
    const terminal = attempts >= MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.notificationOutboxEvent.update({
      where: { id: event.id },
      data: {
        status: terminal ? 'FAILED' : 'PENDING',
        attempts,
        availableAt: terminal
          ? new Date()
          : new Date(Date.now() + 30_000 * 2 ** (attempts - 1)),
        lockedAt: null,
        lastError: message.slice(0, 500),
      },
    });

    if (terminal) {
      const notificationId = this.optionalNotificationId(event.payload);
      if (notificationId) {
        await this.prisma.notification.updateMany({
          where: { id: notificationId, status: 'QUEUED' },
          data: { status: 'FAILED', error: message.slice(0, 500) },
        });
      }
      this.logger.error(
        `Notification outbox ${event.id} failed permanently: ${message}`,
      );
      Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        {
          tags: {
            component: 'notification-outbox',
            outboxEventId: event.id,
          },
        },
      );
      return;
    }

    this.logger.warn(
      `Notification outbox ${event.id} will retry after attempt ${attempts}: ${message}`,
    );
  }

  private emailPayload(
    value: Prisma.JsonValue,
    encryptedPayload: string | null,
  ): EmailJob {
    if (encryptedPayload) {
      const decrypted: unknown = JSON.parse(
        this.crypto.decrypt(encryptedPayload),
      );
      return this.emailPayload(decrypted as Prisma.JsonValue, null);
    }
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('Invalid email outbox payload');
    }
    const payload = value as Record<string, Prisma.JsonValue>;
    const notificationId = this.requiredString(payload.notificationId);
    const to = this.requiredString(payload.to);
    const subject = this.requiredString(payload.subject);
    const html = this.requiredString(payload.html);
    const text = this.requiredString(payload.text);
    return { notificationId, to, subject, html, text };
  }

  private optionalNotificationId(value: Prisma.JsonValue) {
    if (!value || Array.isArray(value) || typeof value !== 'object')
      return null;
    const notificationId = (value as Record<string, Prisma.JsonValue>)[
      'notificationId'
    ];
    return typeof notificationId === 'string' ? notificationId : null;
  }

  private requiredString(value: Prisma.JsonValue | undefined) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('Invalid email outbox payload');
    }
    return value;
  }
}

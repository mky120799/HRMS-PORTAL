import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { EmailTemplates } from '../../common/email/templates';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationPublisherService } from './notification-publisher.service';

const POLL_MS = 60_000;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;

/** Converts held daily/weekly notification items into one email per user. */
@Injectable()
export class NotificationDigestProcessor
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationDigestProcessor.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: NotificationPublisherService,
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
      this.logger.error(`Notification digest drain failed: ${message}`);
      Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        { tags: { component: 'notification-digest' } },
      );
    });
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const leaseExpired = new Date(now.getTime() - LEASE_MS);
      const head = await this.prisma.notificationDigestItem.findFirst({
        where: {
          availableAt: { lte: now },
          OR: [
            { status: 'PENDING' },
            { status: 'QUEUED', lockedAt: { lt: leaseExpired } },
          ],
        },
        orderBy: { availableAt: 'asc' },
      });
      if (!head) return;

      const items = await this.prisma.notificationDigestItem.findMany({
        where: {
          tenantId: head.tenantId,
          userId: head.userId,
          email: head.email,
          availableAt: { lte: now },
          OR: [
            { status: 'PENDING' },
            { status: 'QUEUED', lockedAt: { lt: leaseExpired } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      });
      const ids = items.map((item) => item.id);
      const claimed = await this.prisma.notificationDigestItem.updateMany({
        where: {
          id: { in: ids },
          OR: [
            { status: 'PENDING' },
            { status: 'QUEUED', lockedAt: { lt: leaseExpired } },
          ],
        },
        data: { status: 'QUEUED', lockedAt: now },
      });
      if (!claimed.count) return;

      const suppression = await this.prisma.notificationSuppression.findUnique({
        where: {
          tenantId_email: {
            tenantId: head.tenantId,
            email: head.email.toLowerCase(),
          },
        },
        select: { active: true, reason: true },
      });
      if (suppression?.active) {
        await this.markFailed(
          ids,
          `Email suppressed after ${suppression.reason.toLowerCase()}`,
        );
        return;
      }

      const tenant = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: head.tenantId },
        select: { name: true },
      });
      const email = EmailTemplates.notificationDigest({
        companyName: tenant.name,
        items: items.map((item) => ({
          title: item.title,
          body: item.body,
          link: item.link,
        })),
      });

      const notificationIds = items
        .map((item) => item.notificationId)
        .filter((id): id is string => Boolean(id));
      await this.prisma.$transaction(async (tx) => {
        await this.publisher.publish(tx, {
          tenantId: head.tenantId,
          eventKey: `notification-digest:${head.userId}:${ids[0]}:${ids.length}`,
          eventType: 'NOTIFICATION_DIGEST',
          category: 'GENERAL',
          data: { digestItemIds: ids },
          recipients: [{ userId: head.userId, email: head.email }],
          channels: ['EMAIL'],
          title: 'Notification digest',
          body: `${items.length} notification update(s)`,
          email,
          mandatory: true,
        });
        await tx.notificationDigestItem.updateMany({
          where: { id: { in: ids } },
          data: {
            status: 'SENT',
            processedAt: new Date(),
            lockedAt: null,
            error: null,
          },
        });
        if (notificationIds.length) {
          await tx.notification.updateMany({
            where: { id: { in: notificationIds }, status: 'QUEUED' },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              error: null,
            },
          });
        }
        await tx.notificationDeliverySetting.updateMany({
          where: { tenantId: head.tenantId, userId: head.userId },
          data: { lastDigestSentAt: new Date() },
        });
      });
    } finally {
      this.running = false;
    }
  }

  private async markFailed(ids: string[], message: string) {
    const items = await this.prisma.notificationDigestItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, attempts: true },
    });
    await Promise.all(
      items.map((item) => {
        const attempts = item.attempts + 1;
        const terminal = attempts >= MAX_ATTEMPTS;
        return this.prisma.notificationDigestItem.update({
          where: { id: item.id },
          data: {
            status: terminal ? 'FAILED' : 'PENDING',
            attempts,
            availableAt: terminal
              ? new Date()
              : new Date(Date.now() + 30_000 * 2 ** (attempts - 1)),
            lockedAt: null,
            error: message.slice(0, 500),
            processedAt: terminal ? new Date() : null,
          },
        });
      }),
    );
  }
}

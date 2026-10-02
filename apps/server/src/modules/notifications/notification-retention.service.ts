import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../common/prisma/prisma.service';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_HISTORY_DAYS = 365;
const DEFAULT_COMPLETED_OUTBOX_DAYS = 30;
const DEFAULT_CLEANUP_INTERVAL_HOURS = 24;
const ADVISORY_LOCK_KEY = 746_500_101;

/** Periodically removes old, final notification records without touching pending or failed work. */
@Injectable()
export class NotificationRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationRetentionService.name);
  private readonly historyDays: number;
  private readonly completedOutboxDays: number;
  private readonly cleanupIntervalHours: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.historyDays = this.days(
      config.get<string>('NOTIFICATION_HISTORY_RETENTION_DAYS'),
      DEFAULT_HISTORY_DAYS,
    );
    this.completedOutboxDays = this.days(
      config.get<string>('NOTIFICATION_COMPLETED_OUTBOX_RETENTION_DAYS'),
      DEFAULT_COMPLETED_OUTBOX_DAYS,
    );
    this.cleanupIntervalHours = this.hours(
      config.get<string>('NOTIFICATION_RETENTION_CLEANUP_INTERVAL_HOURS'),
      DEFAULT_CLEANUP_INTERVAL_HOURS,
    );
  }

  onModuleInit() {
    this.timer = setInterval(
      () => this.scheduleCleanup(),
      this.cleanupIntervalHours * HOUR_MS,
    );
    this.timer.unref();
    this.scheduleCleanup();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private scheduleCleanup() {
    void this.cleanup().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Notification retention cleanup failed: ${message}`);
      Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        { tags: { component: 'notification-retention' } },
      );
    });
  }

  async cleanup() {
    if (this.running) return;
    this.running = true;
    let locked = false;
    try {
      locked = await this.tryLock();
      if (!locked) return;

      const now = new Date();
      const historyCutoff = new Date(now.getTime() - this.historyDays * DAY_MS);
      const outboxCutoff = new Date(
        now.getTime() - this.completedOutboxDays * DAY_MS,
      );

      const completedOutbox =
        await this.prisma.notificationOutboxEvent.deleteMany({
          where: {
            status: 'COMPLETED',
            processedAt: { lt: outboxCutoff },
          },
        });

      const oldNotifications = await this.prisma.notification.deleteMany({
        where: {
          createdAt: { lt: historyCutoff },
          OR: [
            { channel: 'EMAIL', status: 'SENT' },
            { channel: 'IN_APP', archivedAt: { not: null } },
            { channel: 'IN_APP', readAt: { not: null } },
          ],
        },
      });

      const oldCampaignRecipients =
        await this.prisma.notificationCampaignRecipient.deleteMany({
          where: {
            campaign: {
              completedAt: { lt: historyCutoff },
              status: { in: ['COMPLETED', 'CANCELLED'] },
            },
          },
        });

      const oldCampaigns = await this.prisma.notificationCampaign.deleteMany({
        where: {
          completedAt: { lt: historyCutoff },
          status: { in: ['COMPLETED', 'CANCELLED'] },
          recipients: { none: {} },
        },
      });

      const orphanedEvents = await this.prisma.notificationEvent.deleteMany({
        where: {
          createdAt: { lt: historyCutoff },
          notifications: { none: {} },
          outboxEvents: { none: {} },
        },
      });

      const deleted =
        completedOutbox.count +
        oldNotifications.count +
        oldCampaignRecipients.count +
        oldCampaigns.count +
        orphanedEvents.count;
      if (deleted > 0) {
        this.logger.log(
          `Notification retention deleted ${deleted} old records ` +
            `(outbox=${completedOutbox.count}, notifications=${oldNotifications.count}, ` +
            `campaignRecipients=${oldCampaignRecipients.count}, campaigns=${oldCampaigns.count}, ` +
            `events=${orphanedEvents.count})`,
        );
      }
    } finally {
      if (locked) await this.unlock();
      this.running = false;
    }
  }

  private async tryLock() {
    const rows = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked
    `;
    return rows[0]?.locked === true;
  }

  private async unlock() {
    await this.prisma.$queryRaw`
      SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})
    `;
  }

  private days(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.floor(parsed);
  }

  private hours(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.floor(parsed);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Administrator-facing delivery health and controlled retry operations. */
@Injectable()
export class NotificationOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(tenantId: string) {
    const stale = new Date(Date.now() - 10 * 60_000);
    const [
      deliveries,
      outbox,
      campaigns,
      digests,
      recentFailures,
      activeSuppressions,
      recentWebhooks,
      stuckOutbox,
      stuckCampaigns,
      failedDigests,
    ] = await Promise.all([
      this.prisma.notification.groupBy({
        by: ['channel', 'status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.notificationOutboxEvent.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.notificationCampaign.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.notificationDigestItem.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.notification.findMany({
        where: { tenantId, channel: 'EMAIL', status: 'FAILED' },
        select: {
          id: true,
          title: true,
          recipientEmail: true,
          error: true,
          eventType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      this.prisma.notificationSuppression.count({
        where: { tenantId, active: true },
      }),
      this.prisma.notificationWebhookEvent.findMany({
        where: { tenantId },
        orderBy: { receivedAt: 'desc' },
        take: 25,
      }),
      this.prisma.notificationOutboxEvent.count({
        where: {
          tenantId,
          status: { in: ['PENDING', 'PROCESSING'] },
          updatedAt: { lt: stale },
        },
      }),
      this.prisma.notificationCampaign.count({
        where: {
          tenantId,
          status: 'PROCESSING',
          lockedAt: { lt: stale },
        },
      }),
      this.prisma.notificationDigestItem.count({
        where: { tenantId, status: 'FAILED' },
      }),
    ]);
    const failedEmail =
      deliveries.find((item) => item.channel === 'EMAIL' && item.status === 'FAILED')
        ?._count._all ?? 0;
    const failedOutbox =
      outbox.find((item) => item.status === 'FAILED')?._count._all ?? 0;
    const alerts = [
      failedEmail ? `${failedEmail} email delivery failure(s)` : null,
      failedOutbox ? `${failedOutbox} failed outbox record(s)` : null,
      stuckOutbox ? `${stuckOutbox} stuck notification outbox record(s)` : null,
      stuckCampaigns ? `${stuckCampaigns} stuck campaign(s)` : null,
      failedDigests ? `${failedDigests} failed digest item(s)` : null,
    ].filter((alert): alert is string => Boolean(alert));
    return {
      deliveries,
      outbox,
      campaigns,
      digests,
      activeSuppressions,
      recentWebhooks,
      recentFailures,
      alerts,
    };
  }

  async retryEmail(tenantId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        tenantId,
        channel: 'EMAIL',
        status: 'FAILED',
      },
      select: { id: true, idempotencyKey: true },
    });
    if (!notification?.idempotencyKey) {
      throw new NotFoundException(
        'Retryable failed email notification not found',
      );
    }
    const outbox = await this.prisma.notificationOutboxEvent.findUnique({
      where: {
        tenantId_eventKey: {
          tenantId,
          eventKey: notification.idempotencyKey,
        },
      },
      select: { id: true },
    });
    if (!outbox) {
      throw new NotFoundException(
        'This legacy email has no durable payload and cannot be retried safely',
      );
    }

    await this.prisma.$transaction([
      this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'QUEUED',
          processingAt: null,
          error: null,
          sentAt: null,
        },
      }),
      this.prisma.notificationOutboxEvent.update({
        where: { id: outbox.id },
        data: {
          status: 'PENDING',
          attempts: 0,
          availableAt: new Date(),
          lockedAt: null,
          lastError: null,
          processedAt: null,
        },
      }),
    ]);
    return { queued: true };
  }
}

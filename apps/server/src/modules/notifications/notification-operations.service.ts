import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Administrator-facing delivery health and controlled retry operations. */
@Injectable()
export class NotificationOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(tenantId: string) {
    const [deliveries, outbox, campaigns, recentFailures] = await Promise.all([
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
    ]);
    return { deliveries, outbox, campaigns, recentFailures };
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

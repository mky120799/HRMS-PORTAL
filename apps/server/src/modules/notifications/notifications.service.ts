import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateNotificationDto, ComposeEmailDto } from './dto/create-notification.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  async createNotification(tenantId: string, dto: CreateNotificationDto, isInternal: boolean = false) {
    let status = 'PENDING';

    if (dto.channel === 'EMAIL' && dto.recipientEmail) {
      await this.notificationsQueue.add('send-email', {
        to: dto.recipientEmail,
        subject: dto.subject ?? dto.title,
        body: dto.body,
        tenantId,
      });
      status = 'PROCESSING';
    }

    return this.prisma.notification.create({
      data: {
        tenantId,
        channel: dto.channel,
        title: dto.title,
        body: dto.body,
        recipientUserId: dto.recipientUserId ?? null,
        recipientEmail: dto.recipientEmail ?? null,
        subject: dto.subject ?? null,
        metadata: dto.metadata ?? undefined,
        status,
      },
    });
  }

  async getNotifications(tenantId: string) {
    return this.prisma.notification.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async composeEmail(tenantId: string, dto: ComposeEmailDto) {
    await this.notificationsQueue.add('send-email', {
      to: dto.to,
      subject: dto.subject,
      body: dto.body,
      tenantId,
    });

    return { message: 'Email queued for sending' };
  }
}

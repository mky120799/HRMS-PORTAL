import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailTemplates } from '../../common/email/templates';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginate, paged } from '../../common/validation/common.schemas';
import type {
  ComposeEmailDto,
  CreateNotificationCampaignDto,
  ListNotificationsQuery,
  UpdateNotificationPreferenceDto,
} from './dto/notification.dto';
import { NotificationPublisherService } from './notification-publisher.service';

const MAX_RECIPIENTS = 1000;

/** Rich-text from the editor is reduced to a small, safe subset: no scripts, styles, iframes or event handlers. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'blockquote',
      'a',
    ],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
    },
  });
}

/**
 * Notifications are the in-app inbox plus the email delivery log.
 * Admins can only email people who belong to their own workspace — the API
 * cannot be used as an open relay to send mail from our domain to anyone.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: NotificationPublisherService,
  ) {}

  async list(user: AuthUser, q: ListNotificationsQuery) {
    if (q.scope === 'all' && user.role !== 'ADMIN')
      throw new ForbiddenException('Only admins can view the delivery log');
    const audience: Prisma.NotificationWhereInput =
      q.scope === 'all'
        ? {}
        : {
            archivedAt: null,
            channel: 'IN_APP',
            recipientUserId: user.userId,
          };
    const where: Prisma.NotificationWhereInput = {
      tenantId: user.tenantId,
      ...audience,
      ...(q.category ? { category: q.category } : {}),
      ...(q.unread === 'true' ? { channel: 'IN_APP', readAt: null } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async markRead(user: AuthUser, id: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        id,
        tenantId: user.tenantId,
        recipientUserId: user.userId,
        channel: 'IN_APP',
      },
      data: { status: 'READ', readAt: new Date() },
    });
    if (!count) throw new NotFoundException('Notification not found');
    return { read: true };
  }

  async unreadCount(user: AuthUser) {
    const count = await this.prisma.notification.count({
      where: {
        tenantId: user.tenantId,
        recipientUserId: user.userId,
        channel: 'IN_APP',
        readAt: null,
        archivedAt: null,
      },
    });
    return { count };
  }

  async markAllRead(user: AuthUser) {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        tenantId: user.tenantId,
        recipientUserId: user.userId,
        channel: 'IN_APP',
        readAt: null,
        archivedAt: null,
      },
      data: { status: 'READ', readAt: new Date() },
    });
    return { updated: count };
  }

  async archive(user: AuthUser, id: string) {
    const now = new Date();
    const { count } = await this.prisma.notification.updateMany({
      where: {
        id,
        tenantId: user.tenantId,
        recipientUserId: user.userId,
        channel: 'IN_APP',
      },
      data: { status: 'READ', readAt: now, archivedAt: now },
    });
    if (!count) throw new NotFoundException('Notification not found');
    return { archived: true };
  }

  listPreferences(user: AuthUser) {
    return this.prisma.notificationPreference.findMany({
      where: { tenantId: user.tenantId, userId: user.userId },
      orderBy: [{ eventType: 'asc' }, { channel: 'asc' }],
    });
  }

  updatePreference(user: AuthUser, dto: UpdateNotificationPreferenceDto) {
    return this.prisma.notificationPreference.upsert({
      where: {
        tenantId_userId_eventType_channel: {
          tenantId: user.tenantId,
          userId: user.userId,
          eventType: dto.eventType,
          channel: dto.channel,
        },
      },
      update: { enabled: dto.enabled },
      create: {
        tenantId: user.tenantId,
        userId: user.userId,
        eventType: dto.eventType,
        channel: dto.channel,
        enabled: dto.enabled,
      },
    });
  }

  async composeEmail(user: AuthUser, dto: ComposeEmailDto) {
    const recipient = await this.prisma.employee.findFirst({
      where: {
        tenantId: user.tenantId,
        email: dto.to,
        status: { not: 'EXITED' },
      },
      select: { id: true, email: true, userId: true },
    });
    if (!recipient)
      throw new BadRequestException(
        'You can only email active members of your workspace',
      );
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: { name: true },
    });
    const safeHtml = sanitizeRichText(dto.body);
    const rendered = EmailTemplates.announcement({
      subject: dto.subject,
      safeHtml,
      companyName: tenant.name,
    });
    await this.prisma.$transaction(async (tx) => {
      await this.publisher.publish(tx, {
        tenantId: user.tenantId,
        eventKey: `admin-direct-message:${randomUUID()}`,
        eventType: 'ADMIN_DIRECT_MESSAGE',
        category: 'ANNOUNCEMENT',
        actorUserId: user.userId,
        data: { subject: dto.subject },
        recipients: [{ userId: recipient.userId, email: recipient.email }],
        channels: ['EMAIL'],
        title: dto.subject,
        body: dto.subject,
        email: rendered,
      });
    });
    return { queued: 1 };
  }

  /** Company or department announcement: an in-app notification for users plus an email to every recipient. */
  async announce(user: AuthUser, dto: CreateNotificationCampaignDto) {
    const campaign = await this.createCampaign(user, dto);
    return {
      queued: campaign.totalRecipients,
      campaignId: campaign.id,
      scheduledAt: campaign.scheduledAt,
    };
  }

  async createCampaign(user: AuthUser, dto: CreateNotificationCampaignDto) {
    const recipients = await this.prisma.employee.findMany({
      where: {
        tenantId: user.tenantId,
        status: { not: 'EXITED' },
        anonymizedAt: null,
        ...(dto.department ? { department: dto.department } : {}),
      },
      select: { id: true, email: true, userId: true },
      take: MAX_RECIPIENTS + 1,
    });
    if (recipients.length === 0)
      throw new BadRequestException('No recipients match this audience');
    if (recipients.length > MAX_RECIPIENTS)
      throw new BadRequestException(
        `Announcements are limited to ${MAX_RECIPIENTS} recipients`,
      );

    const safeHtml = sanitizeRichText(dto.body);
    const scheduledAt = dto.scheduledAt
      ? new Date(dto.scheduledAt)
      : new Date();
    if (scheduledAt.getTime() > Date.now() + 366 * 86_400_000) {
      throw new BadRequestException(
        'An announcement can be scheduled at most one year ahead',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const campaign = await tx.notificationCampaign.create({
        data: {
          tenantId: user.tenantId,
          createdByUserId: user.userId,
          subject: dto.subject,
          body: safeHtml,
          audience: dto.department
            ? { type: 'DEPARTMENT', department: dto.department }
            : { type: 'ALL_ACTIVE_EMPLOYEES' },
          scheduledAt,
          totalRecipients: recipients.length,
        },
      });
      await tx.notificationCampaignRecipient.createMany({
        data: recipients.map((recipient) => ({
          tenantId: user.tenantId,
          campaignId: campaign.id,
          employeeId: recipient.id,
          userId: recipient.userId,
          email: recipient.email.toLowerCase(),
        })),
      });
      return campaign;
    });
  }

  listCampaigns(user: AuthUser) {
    return this.prisma.notificationCampaign.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async campaign(user: AuthUser, id: string) {
    const campaign = await this.prisma.notificationCampaign.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        recipients: {
          orderBy: { createdAt: 'asc' },
          take: 100,
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async cancelCampaign(user: AuthUser, id: string) {
    const result = await this.prisma.notificationCampaign.updateMany({
      where: { id, tenantId: user.tenantId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED', completedAt: new Date(), lockedAt: null },
    });
    if (result.count) return { cancelled: true };
    const exists = await this.prisma.notificationCampaign.count({
      where: { id, tenantId: user.tenantId },
    });
    if (!exists) throw new NotFoundException('Campaign not found');
    throw new ConflictException('Only a scheduled campaign can be cancelled');
  }
}

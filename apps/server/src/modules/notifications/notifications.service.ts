import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { EmailTemplates } from '../../common/email/templates';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginate, paged } from '../../common/validation/common.schemas';
import type { AnnounceDto, ComposeEmailDto, ListNotificationsQuery } from './dto/notification.dto';

const MAX_RECIPIENTS = 1000;

/** Rich-text from the editor is reduced to a small, safe subset: no scripts, styles, iframes or event handlers. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'a'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
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
    private readonly email: EmailService,
  ) {}

  async list(user: AuthUser, q: ListNotificationsQuery) {
    if (q.scope === 'all' && user.role !== 'ADMIN') throw new ForbiddenException('Only admins can view the delivery log');
    const where: Prisma.NotificationWhereInput =
      q.scope === 'all'
        ? { tenantId: user.tenantId }
        : { tenantId: user.tenantId, OR: [{ recipientUserId: user.userId }, { recipientEmail: user.email }] };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q) }),
      this.prisma.notification.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async markRead(user: AuthUser, id: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, tenantId: user.tenantId, recipientUserId: user.userId, channel: 'IN_APP' },
      data: { status: 'READ' },
    });
    if (!count) throw new NotFoundException('Notification not found');
    return { read: true };
  }

  async composeEmail(user: AuthUser, dto: ComposeEmailDto) {
    const recipient = await this.prisma.employee.findFirst({
      where: { tenantId: user.tenantId, email: dto.to, status: { not: 'EXITED' } },
      select: { email: true, userId: true },
    });
    if (!recipient) throw new BadRequestException('You can only email active members of your workspace');
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true } });
    await this.email.send({
      tenantId: user.tenantId,
      to: recipient.email,
      recipientUserId: recipient.userId,
      email: EmailTemplates.announcement({ subject: dto.subject, safeHtml: sanitizeRichText(dto.body), companyName: tenant.name }),
    });
    return { queued: 1 };
  }

  /** Company or department announcement: an in-app notification for users plus an email to every recipient. */
  async announce(user: AuthUser, dto: AnnounceDto) {
    const recipients = await this.prisma.employee.findMany({
      where: { tenantId: user.tenantId, status: { not: 'EXITED' }, anonymizedAt: null, ...(dto.department ? { department: dto.department } : {}) },
      select: { email: true, userId: true },
      take: MAX_RECIPIENTS + 1,
    });
    if (recipients.length === 0) throw new BadRequestException('No recipients match this audience');
    if (recipients.length > MAX_RECIPIENTS) throw new BadRequestException(`Announcements are limited to ${MAX_RECIPIENTS} recipients`);

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true } });
    const safeHtml = sanitizeRichText(dto.body);
    const rendered = EmailTemplates.announcement({ subject: dto.subject, safeHtml, companyName: tenant.name });

    const inApp = recipients.filter((r) => r.userId);
    if (inApp.length) {
      await this.prisma.notification.createMany({
        data: inApp.map((r) => ({ tenantId: user.tenantId, channel: 'IN_APP', title: dto.subject, body: safeHtml, recipientUserId: r.userId, status: 'SENT', sentAt: new Date() })),
      });
    }
    for (const r of recipients) {
      await this.email.send({ tenantId: user.tenantId, to: r.email, recipientUserId: r.userId, email: rendered });
    }
    return { queued: recipients.length };
  }
}

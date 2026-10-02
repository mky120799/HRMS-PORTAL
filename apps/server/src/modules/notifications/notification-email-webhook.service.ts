import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { EmailWebhookDto } from './dto/notification.dto';

/** Handles signed email-provider delivery callbacks. */
@Injectable()
export class NotificationEmailWebhookService {
  private readonly logger = new Logger(NotificationEmailWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async handle(
    signature: string | undefined,
    rawBody: Buffer | undefined,
    body: EmailWebhookDto,
  ) {
    this.verify(signature, rawBody);
    const normalized = await this.normalize(body);
    if (!normalized.notificationId && !normalized.email) {
      throw new BadRequestException('Webhook does not identify a notification');
    }

    try {
      await this.prisma.notificationWebhookEvent.create({
        data: {
          id: normalized.eventId,
          tenantId: normalized.tenantId,
          notificationId: normalized.notificationId,
          email: normalized.email,
          eventType: normalized.eventType,
          status: normalized.status,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { received: true, duplicate: true };
      }
      throw error;
    }

    if (normalized.notificationId) {
      await this.prisma.notification.updateMany({
        where: {
          id: normalized.notificationId,
          ...(normalized.tenantId ? { tenantId: normalized.tenantId } : {}),
          channel: 'EMAIL',
        },
        data: {
          status: normalized.status,
          error: normalized.error,
          metadata: {
            provider: 'SES',
            providerEventId: normalized.eventId,
            providerEventType: normalized.eventType,
          },
        },
      });
    }

    if (
      normalized.tenantId &&
      normalized.email &&
      ['BOUNCED', 'COMPLAINED'].includes(normalized.status)
    ) {
      await this.prisma.notificationSuppression.upsert({
        where: {
          tenantId_email: {
            tenantId: normalized.tenantId,
            email: normalized.email,
          },
        },
        update: {
          active: true,
          reason: normalized.status === 'BOUNCED' ? 'BOUNCE' : 'COMPLAINT',
          source: 'SES',
          count: { increment: 1 },
          lastEventAt: new Date(),
        },
        create: {
          tenantId: normalized.tenantId,
          email: normalized.email,
          reason: normalized.status === 'BOUNCED' ? 'BOUNCE' : 'COMPLAINT',
          source: 'SES',
        },
      });
    }

    return { received: true, status: normalized.status };
  }

  private verify(signature: string | undefined, rawBody: Buffer | undefined) {
    const secret = this.config.get<string>('EMAIL_WEBHOOK_SECRET');
    if (!secret)
      throw new ServiceUnavailableException(
        'Email webhook secret not configured',
      );
    if (!signature || !rawBody)
      throw new BadRequestException('Missing email webhook signature');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const supplied = signature.replace(/^sha256=/, '').trim();
    const expectedBytes = Buffer.from(expected, 'hex');
    const suppliedBytes = Buffer.from(supplied, 'hex');
    if (
      suppliedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(suppliedBytes, expectedBytes)
    ) {
      this.logger.warn('Rejected email webhook with invalid signature');
      throw new BadRequestException('Invalid email webhook signature');
    }
  }

  private async normalize(body: EmailWebhookDto) {
    const eventType = (
      body.eventType ??
      (body.delivery ? 'DELIVERY' : body.bounce ? 'BOUNCE' : undefined) ??
      (body.complaint ? 'COMPLAINT' : 'UNKNOWN')
    ).toUpperCase();
    const status =
      body.status?.toUpperCase() ??
      ({
        DELIVERY: 'DELIVERED',
        BOUNCE: 'BOUNCED',
        COMPLAINT: 'COMPLAINED',
        REJECT: 'REJECTED',
        SEND: 'SENT',
      }[eventType] ||
        eventType);
    const notificationId =
      body.notificationId ?? this.firstTag(body.mail?.tags?.notificationId);
    const tenantId = body.tenantId ?? this.firstTag(body.mail?.tags?.tenantId);
    const notification = notificationId
      ? await this.prisma.notification.findUnique({
          where: { id: notificationId },
          select: { tenantId: true, recipientEmail: true },
        })
      : null;
    const email = (
      body.email ??
      body.mail?.destination?.[0] ??
      notification?.recipientEmail ??
      ''
    )
      .trim()
      .toLowerCase();
    const resolvedTenantId = tenantId ?? notification?.tenantId ?? null;
    return {
      eventId:
        body.eventId ??
        `${body.mail?.messageId ?? notificationId ?? email}:${eventType}`,
      tenantId: resolvedTenantId,
      notificationId: notificationId ?? null,
      email: email || null,
      eventType,
      status,
      error: ['BOUNCED', 'COMPLAINED', 'REJECTED'].includes(status)
        ? `SES reported ${status.toLowerCase()}`
        : null,
    };
  }

  private firstTag(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
  }
}

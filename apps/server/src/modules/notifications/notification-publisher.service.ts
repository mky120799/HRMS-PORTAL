import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RenderedEmail } from '../../common/email/templates';

export type NotificationChannel = 'IN_APP' | 'EMAIL';

export interface NotificationRecipientInput {
  userId?: string | null;
  email?: string | null;
}

export interface PublishNotificationInput {
  tenantId: string;
  eventKey: string;
  eventType: string;
  category: string;
  actorUserId?: string | null;
  data: Prisma.InputJsonValue;
  recipients: NotificationRecipientInput[];
  channels: NotificationChannel[];
  title: string;
  body: string;
  link?: string;
  email?: RenderedEmail;
  mandatory?: boolean;
}

/**
 * Persists a business notification and its delivery work in the caller's
 * transaction. It deliberately does not contact RabbitMQ: the outbox processor
 * performs that hand-off after the database commit succeeds.
 */
@Injectable()
export class NotificationPublisherService {
  async publish(
    tx: Prisma.TransactionClient,
    input: PublishNotificationInput,
  ) {
    const event = await tx.notificationEvent.upsert({
      where: {
        tenantId_eventKey: {
          tenantId: input.tenantId,
          eventKey: input.eventKey,
        },
      },
      update: {},
      create: {
        tenantId: input.tenantId,
        eventKey: input.eventKey,
        eventType: input.eventType,
        category: input.category,
        actorUserId: input.actorUserId ?? null,
        data: input.data,
      },
    });

    const userIds = input.recipients
      .map((recipient) => recipient.userId)
      .filter((userId): userId is string => Boolean(userId));
    const preferences = input.mandatory
      ? []
      : await tx.notificationPreference.findMany({
          where: {
            tenantId: input.tenantId,
            userId: { in: userIds },
            eventType: { in: ['*', input.eventType] },
            channel: { in: input.channels },
          },
        });

    const enabled = (userId: string | null | undefined, channel: string) => {
      if (input.mandatory || !userId) return true;
      const specific = preferences.find(
        (preference) =>
          preference.userId === userId &&
          preference.eventType === input.eventType &&
          preference.channel === channel,
      );
      const fallback = preferences.find(
        (preference) =>
          preference.userId === userId &&
          preference.eventType === '*' &&
          preference.channel === channel,
      );
      return specific?.enabled ?? fallback?.enabled ?? true;
    };

    for (const recipient of input.recipients) {
      const email = recipient.email?.trim().toLowerCase() || null;
      const recipientKey = recipient.userId
        ? `user:${recipient.userId}`
        : email
          ? `email:${email}`
          : null;
      if (!recipientKey) continue;

      if (
        recipient.userId &&
        input.channels.includes('IN_APP') &&
        enabled(recipient.userId, 'IN_APP')
      ) {
        await tx.notification.upsert({
          where: {
            tenantId_idempotencyKey: {
              tenantId: input.tenantId,
              idempotencyKey: `${input.eventKey}:in-app:${recipientKey}`,
            },
          },
          update: {},
          create: {
            tenantId: input.tenantId,
            eventId: event.id,
            eventType: input.eventType,
            category: input.category,
            channel: 'IN_APP',
            title: input.title,
            body: input.body,
            recipientUserId: recipient.userId,
            recipientEmail: email,
            idempotencyKey: `${input.eventKey}:in-app:${recipientKey}`,
            status: 'SENT',
            sentAt: new Date(),
            link: input.link,
          },
        });
      }

      if (
        email &&
        input.email &&
        input.channels.includes('EMAIL') &&
        enabled(recipient.userId, 'EMAIL')
      ) {
        const deliveryKey = `${input.eventKey}:email:${recipientKey}`;
        const notification = await tx.notification.upsert({
          where: {
            tenantId_idempotencyKey: {
              tenantId: input.tenantId,
              idempotencyKey: deliveryKey,
            },
          },
          update: {},
          create: {
            tenantId: input.tenantId,
            eventId: event.id,
            eventType: input.eventType,
            category: input.category,
            channel: 'EMAIL',
            title: input.email.subject,
            subject: input.email.subject,
            body: input.email.html,
            recipientUserId: recipient.userId ?? null,
            recipientEmail: email,
            idempotencyKey: deliveryKey,
            status: 'QUEUED',
            link: input.link,
          },
        });
        await tx.notificationOutboxEvent.upsert({
          where: {
            tenantId_eventKey: {
              tenantId: input.tenantId,
              eventKey: deliveryKey,
            },
          },
          update: {},
          create: {
            tenantId: input.tenantId,
            notificationEventId: event.id,
            eventKey: deliveryKey,
            type: 'EMAIL',
            payload: {
              notificationId: notification.id,
              to: email,
              subject: input.email.subject,
              html: input.email.html,
              text: input.email.text,
            },
          },
        });
      }
    }

    return event;
  }
}

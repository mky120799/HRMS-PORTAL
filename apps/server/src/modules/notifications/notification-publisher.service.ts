import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { RenderedEmail } from '../../common/email/templates';
import { NotificationRealtimeService } from './notification-realtime.service';

export type NotificationChannel = 'IN_APP' | 'EMAIL';
type DigestFrequency = 'IMMEDIATE' | 'DAILY' | 'WEEKLY';

type DeliverySetting = {
  userId: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietStartMinutes: number | null;
  quietEndMinutes: number | null;
  digestFrequency: string;
  digestHour: number;
  digestDayOfWeek: number;
};

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
  sensitive?: boolean;
}

/**
 * Persists a business notification and its delivery work in the caller's
 * transaction. It deliberately does not contact RabbitMQ: the outbox processor
 * performs that hand-off after the database commit succeeds.
 */
@Injectable()
export class NotificationPublisherService {
  constructor(
    private readonly crypto: CryptoService,
    private readonly realtime: NotificationRealtimeService,
  ) {}

  async publish(tx: Prisma.TransactionClient, input: PublishNotificationInput) {
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
    const renderedEmail = input.email
      ? await this.renderEmail(tx, input, input.email)
      : null;

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
    const settings = input.mandatory
      ? []
      : await tx.notificationDeliverySetting.findMany({
          where: { tenantId: input.tenantId, userId: { in: userIds } },
          select: {
            userId: true,
            timezone: true,
            quietHoursEnabled: true,
            quietStartMinutes: true,
            quietEndMinutes: true,
            digestFrequency: true,
            digestHour: true,
            digestDayOfWeek: true,
          },
        });
    const emails = input.recipients
      .map((recipient) => recipient.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email));
    const suppressions = input.mandatory
      ? []
      : await tx.notificationSuppression.findMany({
          where: {
            tenantId: input.tenantId,
            email: { in: emails },
            active: true,
          },
          select: { email: true, reason: true },
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
    const settingFor = (userId: string | null | undefined) =>
      userId ? settings.find((setting) => setting.userId === userId) : null;
    const suppressed = (email: string | null) =>
      email ? suppressions.find((item) => item.email === email) : null;

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
        this.realtime.notifyUser(
          input.tenantId,
          recipient.userId,
          input.eventType,
        );
      }

      if (
        email &&
        renderedEmail &&
        input.channels.includes('EMAIL') &&
        enabled(recipient.userId, 'EMAIL')
      ) {
        const deliveryKey = `${input.eventKey}:email:${recipientKey}`;
        const suppression = suppressed(email);
        const setting = settingFor(recipient.userId);
        const digestFrequency = this.digestFrequency(setting);
        const digestDelivery =
          !input.mandatory &&
          recipient.userId &&
          digestFrequency !== 'IMMEDIATE';
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
            title: renderedEmail.subject,
            subject: renderedEmail.subject,
            body: input.sensitive
              ? '[redacted: contains a one-time credential link]'
              : renderedEmail.html,
            recipientUserId: recipient.userId ?? null,
            recipientEmail: email,
            idempotencyKey: deliveryKey,
            status: suppression ? 'SUPPRESSED' : 'QUEUED',
            link: input.link,
            error: suppression
              ? `Email suppressed after ${suppression.reason.toLowerCase()}`
              : null,
            metadata: digestDelivery
              ? { digestFrequency }
              : suppression
                ? { suppressionReason: suppression.reason }
                : undefined,
          },
        });
        if (suppression) continue;
        if (digestDelivery) {
          await tx.notificationDigestItem.upsert({
            where: {
              tenantId_digestKey: {
                tenantId: input.tenantId,
                digestKey: deliveryKey,
              },
            },
            update: {},
            create: {
              tenantId: input.tenantId,
              userId: recipient.userId!,
              email,
              digestKey: deliveryKey,
              eventType: input.eventType,
              category: input.category,
              title: input.title,
              body: input.body,
              link: input.link,
              notificationId: notification.id,
              availableAt: this.nextDigestAt(setting, new Date()),
            },
          });
          continue;
        }
        const emailJob = {
          notificationId: notification.id,
          to: email,
          subject: renderedEmail.subject,
          html: renderedEmail.html,
          text: renderedEmail.text,
        };
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
            payload: input.sensitive
              ? { notificationId: notification.id }
              : emailJob,
            encryptedPayload: input.sensitive
              ? this.crypto.encrypt(JSON.stringify(emailJob))
              : null,
            availableAt: this.nextEmailAttemptAt(setting, new Date()),
          },
        });
      }
    }

    return event;
  }

  private digestFrequency(setting: DeliverySetting | null | undefined) {
    const value = setting?.digestFrequency;
    return value === 'DAILY' || value === 'WEEKLY'
      ? (value as DigestFrequency)
      : 'IMMEDIATE';
  }

  private async renderEmail(
    tx: Prisma.TransactionClient,
    input: PublishNotificationInput,
    fallback: RenderedEmail,
  ): Promise<RenderedEmail> {
    const template = await tx.notificationTemplate.findFirst({
      where: {
        tenantId: input.tenantId,
        eventType: input.eventType,
        channel: 'EMAIL',
        isActive: true,
      },
      orderBy: { version: 'desc' },
    });
    if (!template) return fallback;
    const tenant = await tx.tenant.findUnique({
      where: { id: input.tenantId },
      select: { name: true },
    });
    const variables = this.templateVariables(input, tenant?.name);
    return {
      subject: this.interpolate(template.subjectTemplate, variables, false),
      html: this.interpolate(template.htmlTemplate, variables, true),
      text: this.interpolate(template.textTemplate, variables, false),
    };
  }

  private templateVariables(input: PublishNotificationInput, companyName = '') {
    const data =
      input.data && !Array.isArray(input.data) && typeof input.data === 'object'
        ? (input.data as Record<string, Prisma.JsonValue>)
        : {};
    const variables: Record<string, unknown> = {
      ...data,
      title: input.title,
      body: input.body,
      link: input.link ?? '',
      companyName,
      eventType: input.eventType,
      category: input.category,
    };
    return variables;
  }

  private interpolate(
    template: string,
    variables: Record<string, unknown>,
    html: boolean,
  ) {
    return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_m, key) => {
      const value = variables[key] ?? '';
      return html ? this.escapeHtml(value) : String(value);
    });
  }

  private escapeHtml(value: unknown) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private nextEmailAttemptAt(
    setting: DeliverySetting | null | undefined,
    now: Date,
  ) {
    if (
      !setting?.quietHoursEnabled ||
      setting.quietStartMinutes == null ||
      setting.quietEndMinutes == null ||
      setting.quietStartMinutes === setting.quietEndMinutes
    ) {
      return now;
    }
    if (!this.inQuietHours(now, setting)) return now;
    for (let i = 1; i <= 192; i += 1) {
      const candidate = new Date(now.getTime() + i * 15 * 60_000);
      if (!this.inQuietHours(candidate, setting)) return candidate;
    }
    return new Date(now.getTime() + 24 * 60 * 60_000);
  }

  private nextDigestAt(
    setting: DeliverySetting | null | undefined,
    now: Date,
  ) {
    const frequency = this.digestFrequency(setting);
    if (!setting || frequency === 'IMMEDIATE') return now;
    for (let i = 1; i <= 14 * 24 * 4; i += 1) {
      const candidate = new Date(now.getTime() + i * 15 * 60_000);
      const local = this.localTime(candidate, setting.timezone);
      const dueHour = local.hour === setting.digestHour && local.minute < 15;
      const dueDay =
        frequency === 'DAILY' || local.dayOfWeek === setting.digestDayOfWeek;
      if (dueHour && dueDay) return candidate;
    }
    return new Date(now.getTime() + 24 * 60 * 60_000);
  }

  private inQuietHours(date: Date, setting: DeliverySetting) {
    const start = setting.quietStartMinutes;
    const end = setting.quietEndMinutes;
    if (start == null || end == null) return false;
    const minutes = this.localTime(date, setting.timezone).minutes;
    return start < end
      ? minutes >= start && minutes < end
      : minutes >= start || minutes < end;
  }

  private localTime(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '0';
    const hour = Number(get('hour')) % 24;
    const minute = Number(get('minute'));
    const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      get('weekday'),
    );
    return {
      hour,
      minute,
      dayOfWeek: Math.max(dayOfWeek, 0),
      minutes: hour * 60 + minute,
    };
  }
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import sanitizeHtml from 'sanitize-html';
import { EmailTemplates } from '../../common/email/templates';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationPublisherService } from './notification-publisher.service';

const POLL_MS = 5_000;
const LEASE_MS = 5 * 60_000;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;

/** Expands a scheduled campaign into durable per-recipient notifications. */
@Injectable()
export class NotificationCampaignProcessor
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationCampaignProcessor.name);
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
      this.logger.error(`Notification campaign drain failed: ${message}`);
      Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        { tags: { component: 'notification-campaign' } },
      );
    });
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const leaseExpired = new Date(now.getTime() - LEASE_MS);
      const campaign = await this.prisma.notificationCampaign.findFirst({
        where: {
          scheduledAt: { lte: now },
          OR: [
            { status: 'SCHEDULED' },
            {
              status: 'PROCESSING',
              OR: [{ lockedAt: null }, { lockedAt: { lt: leaseExpired } }],
            },
          ],
        },
        orderBy: { scheduledAt: 'asc' },
      });
      if (!campaign) return;

      const claimed = await this.prisma.notificationCampaign.updateMany({
        where: {
          id: campaign.id,
          OR: [
            { status: 'SCHEDULED' },
            {
              status: 'PROCESSING',
              OR: [{ lockedAt: null }, { lockedAt: { lt: leaseExpired } }],
            },
          ],
        },
        data: {
          status: 'PROCESSING',
          lockedAt: now,
          startedAt: campaign.startedAt ?? now,
        },
      });
      if (!claimed.count) return;

      const recipients =
        await this.prisma.notificationCampaignRecipient.findMany({
          where: {
            tenantId: campaign.tenantId,
            campaignId: campaign.id,
            status: 'PENDING',
            availableAt: { lte: now },
          },
          orderBy: { createdAt: 'asc' },
          take: BATCH_SIZE,
        });
      const tenant = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: campaign.tenantId },
        select: { name: true },
      });
      const email = EmailTemplates.announcement({
        subject: campaign.subject,
        safeHtml: campaign.body,
        companyName: tenant.name,
      });
      const plainBody = sanitizeHtml(campaign.body, {
        allowedTags: [],
        allowedAttributes: {},
      }).trim();

      for (const recipient of recipients) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await this.publisher.publish(tx, {
              tenantId: campaign.tenantId,
              eventKey: `announcement:${campaign.id}:${recipient.id}`,
              eventType: 'COMPANY_ANNOUNCEMENT',
              category: 'ANNOUNCEMENT',
              actorUserId: campaign.createdByUserId,
              data: {
                campaignId: campaign.id,
                employeeId: recipient.employeeId,
              },
              recipients: [
                { userId: recipient.userId, email: recipient.email },
              ],
              channels: ['IN_APP', 'EMAIL'],
              title: campaign.subject,
              body: plainBody,
              email,
            });
            await tx.notificationCampaignRecipient.update({
              where: { id: recipient.id },
              data: {
                status: 'QUEUED',
                processedAt: new Date(),
                error: null,
              },
            });
            await tx.notificationCampaign.update({
              where: { id: campaign.id },
              data: {
                processedRecipients: { increment: 1 },
                lockedAt: new Date(),
              },
            });
          });
        } catch (error: unknown) {
          await this.recordRecipientFailure(campaign.id, recipient, error);
        }
      }

      const pending = await this.prisma.notificationCampaignRecipient.count({
        where: { campaignId: campaign.id, status: 'PENDING' },
      });
      await this.prisma.notificationCampaign.update({
        where: { id: campaign.id },
        data: pending
          ? { status: 'PROCESSING', lockedAt: null }
          : { status: 'COMPLETED', completedAt: new Date(), lockedAt: null },
      });
    } finally {
      this.running = false;
    }
  }

  private async recordRecipientFailure(
    campaignId: string,
    recipient: { id: string; attempts: number },
    error: unknown,
  ) {
    const attempts = recipient.attempts + 1;
    const terminal = attempts >= MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.$transaction([
      this.prisma.notificationCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: terminal ? 'FAILED' : 'PENDING',
          attempts,
          availableAt: terminal
            ? new Date()
            : new Date(Date.now() + 30_000 * 2 ** (attempts - 1)),
          processedAt: terminal ? new Date() : null,
          error: message.slice(0, 500),
        },
      }),
      ...(terminal
        ? [
            this.prisma.notificationCampaign.update({
              where: { id: campaignId },
              data: {
                processedRecipients: { increment: 1 },
                failedRecipients: { increment: 1 },
              },
            }),
          ]
        : []),
    ]);
    if (terminal) {
      Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        {
          tags: {
            component: 'notification-campaign-recipient',
            campaignId,
            recipientId: recipient.id,
          },
        },
      );
    }
  }
}

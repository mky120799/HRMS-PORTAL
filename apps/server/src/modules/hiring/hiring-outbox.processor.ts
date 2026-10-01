import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { RabbitMqService, HIRING_QUEUE } from '../../common/messaging/rabbitmq.service';
import { SlackService } from '../integrations/slack.service';

const POLL_MS = 2_000;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

type EmailPayload = { to: string; recipientUserId?: string | null; subject: string; html: string; text: string };
type QueuePayload = { jobType: string; data: unknown };
type SlackPayload = { jobTitle: string; candidateName: string };

/** Delivers durable hiring side effects with leases and bounded retries. */
@Injectable()
export class HiringOutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HiringOutboxProcessor.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly rabbit: RabbitMqService,
    private readonly slack: SlackService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.drain(), POLL_MS);
    this.timer.unref();
    void this.drain();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const leaseExpired = new Date(now.getTime() - LEASE_MS);
      const events = await this.prisma.hiringOutboxEvent.findMany({
        where: {
          availableAt: { lte: now },
          OR: [{ status: 'PENDING' }, { status: 'PROCESSING', lockedAt: { lt: leaseExpired } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 25,
      });
      for (const event of events) {
        const claimed = await this.prisma.hiringOutboxEvent.updateMany({
          where: {
            id: event.id,
            availableAt: { lte: now },
            OR: [{ status: 'PENDING' }, { status: 'PROCESSING', lockedAt: { lt: leaseExpired } }],
          },
          data: { status: 'PROCESSING', lockedAt: now },
        });
        if (!claimed.count) continue;
        await this.deliver(event).catch((error) => this.fail(event.id, event.attempts, error));
      }
    } finally {
      this.running = false;
    }
  }

  private async deliver(event: { id: string; tenantId: string; eventKey: string; type: string; payload: Prisma.JsonValue }) {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'EMAIL') {
      const email = payload as EmailPayload;
      await this.email.send({
        tenantId: event.tenantId,
        to: email.to,
        recipientUserId: email.recipientUserId,
        idempotencyKey: event.eventKey,
        email: { subject: email.subject, html: email.html, text: email.text },
      });
    } else if (event.type === 'HIRING_QUEUE') {
      const queue = payload as QueuePayload;
      await this.rabbit.publish(HIRING_QUEUE, queue.jobType, queue.data);
    } else if (event.type === 'SLACK_NEW_APPLICATION') {
      const slack = payload as SlackPayload;
      await this.slack.newApplication(event.tenantId, slack);
    } else {
      throw new Error(`Unsupported hiring outbox type ${event.type}`);
    }
    await this.prisma.hiringOutboxEvent.update({ where: { id: event.id }, data: { status: 'COMPLETED', processedAt: new Date(), lockedAt: null, lastError: null } });
  }

  private async fail(id: string, attempts: number, error: unknown) {
    const nextAttempts = attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    const terminal = nextAttempts >= MAX_ATTEMPTS;
    await this.prisma.hiringOutboxEvent.update({
      where: { id },
      data: {
        status: terminal ? 'FAILED' : 'PENDING',
        attempts: nextAttempts,
        availableAt: terminal ? new Date() : new Date(Date.now() + 30_000 * 2 ** (nextAttempts - 1)),
        lockedAt: null,
        lastError: message.slice(0, 500),
      },
    });
    const log = terminal ? this.logger.error.bind(this.logger) : this.logger.warn.bind(this.logger);
    log(`Hiring outbox ${id} ${terminal ? 'failed permanently' : 'will retry'}: ${message}`);
  }
}

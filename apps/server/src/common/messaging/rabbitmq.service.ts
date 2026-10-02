import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import * as Sentry from '@sentry/nestjs';

export const EMAIL_QUEUE = 'hrms.email';
export const HIRING_QUEUE = 'hrms.hiring';
export const LEAVE_PROCESSING_QUEUE = 'hrms.leave-processing';

type Envelope<T> = { type: string; payload: T; attempt: number };
type ConsumerOptions = {
  concurrency?: number;
  attempts?: number;
  retryDelayMs?: number;
};

/**
 * Durable RabbitMQ transport with delayed retry queues and a dead-letter queue
 * per workload. Producers never depend on worker availability; messages are
 * persisted by RabbitMQ before publish resolves.
 */
@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private connection!: amqp.ChannelModel;
  private publisher!: amqp.ConfirmChannel;
  private readonly consumerChannels: amqp.Channel[] = [];
  private readonly declared = new Set<string>();
  private shuttingDown = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.connection = await amqp.connect(
      this.config.get('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'),
    );
    this.publisher = await this.connection.createConfirmChannel();
    this.connection.on('error', (error: Error) =>
      this.logger.error(`RabbitMQ connection error: ${error.message}`),
    );
    this.connection.on('close', () => {
      if (!this.shuttingDown)
        this.logger.error(
          'RabbitMQ connection closed; restart the worker process after broker recovery',
        );
    });
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    await Promise.all(
      this.consumerChannels.map((channel) =>
        channel.close().catch(() => undefined),
      ),
    );
    await this.publisher?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  async publish<T>(queue: string, type: string, payload: T) {
    await this.declare(queue);
    const message: Envelope<T> = { type, payload, attempt: 0 };
    if (
      !this.publisher.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        contentType: 'application/json',
      })
    ) {
      await new Promise<void>((resolve) =>
        this.publisher.once('drain', resolve),
      );
    }
    await this.publisher.waitForConfirms();
  }

  async consume<T>(
    queue: string,
    handler: (message: Envelope<T>) => Promise<void>,
    options: ConsumerOptions = {},
  ) {
    await this.declare(queue);
    const channel = await this.connection.createConfirmChannel();
    this.consumerChannels.push(channel);
    await channel.prefetch(options.concurrency ?? 1);
    await channel.consume(
      queue,
      (raw) => {
        if (!raw) return;
        void this.processMessage(channel, queue, raw, handler, options).catch(
          (error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `RabbitMQ consumer failure on ${queue}: ${message}`,
            );
            try {
              channel.nack(raw, false, true);
            } catch {
              // Channel already closing (shutdown): the broker redelivers unacked messages anyway.
            }
          },
        );
      },
      { noAck: false },
    );
  }

  private async processMessage<T>(
    channel: amqp.ConfirmChannel,
    queue: string,
    raw: amqp.ConsumeMessage,
    handler: (message: Envelope<T>) => Promise<void>,
    options: ConsumerOptions,
  ) {
    let message: Envelope<T>;
    try {
      message = JSON.parse(raw.content.toString()) as Envelope<T>;
    } catch {
      this.logger.error(`Discarding malformed RabbitMQ message from ${queue}`);
      channel.ack(raw);
      return;
    }
    try {
      await handler(message);
      channel.ack(raw);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const attempt = message.attempt + 1;
      const maxAttempts = options.attempts ?? 5;
      if (attempt >= maxAttempts) {
        channel.sendToQueue(
          `${queue}.dead`,
          Buffer.from(JSON.stringify({ ...message, attempt })),
          { persistent: true, contentType: 'application/json' },
        );
        await channel.waitForConfirms();
        this.logger.error(
          `Message ${message.type} moved to ${queue}.dead after ${attempt} attempts: ${errorMessage}`,
        );
        Sentry.captureException(error, {
          tags: {
            component: 'rabbitmq-consumer',
            queue,
            messageType: message.type,
            attempt: String(attempt),
          },
        });
      } else {
        const delay = (options.retryDelayMs ?? 30_000) * 2 ** (attempt - 1);
        channel.sendToQueue(
          `${queue}.retry`,
          Buffer.from(JSON.stringify({ ...message, attempt })),
          {
            persistent: true,
            expiration: String(delay),
            contentType: 'application/json',
          },
        );
        await channel.waitForConfirms();
        this.logger.warn(
          `Retrying ${message.type} from ${queue} in ${delay}ms (attempt ${attempt}): ${errorMessage}`,
        );
      }
      channel.ack(raw);
    }
  }

  async check() {
    await this.publisher.checkQueue(EMAIL_QUEUE);
    await this.publisher.checkQueue(HIRING_QUEUE);
    await this.publisher.checkQueue(LEAVE_PROCESSING_QUEUE);
    return 'up';
  }

  private async declare(queue: string) {
    if (this.declared.has(queue)) return;
    await this.publisher.assertQueue(queue, { durable: true });
    await this.publisher.assertQueue(`${queue}.retry`, {
      durable: true,
      deadLetterExchange: '',
      deadLetterRoutingKey: queue,
    });
    await this.publisher.assertQueue(`${queue}.dead`, { durable: true });
    this.declared.add(queue);
  }
}

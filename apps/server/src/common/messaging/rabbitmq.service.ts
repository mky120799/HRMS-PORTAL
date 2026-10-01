import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

export const EMAIL_QUEUE = 'hrms.email';
export const HIRING_QUEUE = 'hrms.hiring';
export const LEAVE_PROCESSING_QUEUE = 'hrms.leave-processing';

type Envelope<T> = { type: string; payload: T; attempt: number };
type ConsumerOptions = { concurrency?: number; attempts?: number; retryDelayMs?: number };

/**
 * Durable RabbitMQ transport with delayed retry queues and a dead-letter queue
 * per workload. Producers never depend on worker availability; messages are
 * persisted by RabbitMQ before publish resolves.
 */
@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private connection!: amqp.ChannelModel;
  private publisher!: amqp.Channel;
  private readonly consumerChannels: amqp.Channel[] = [];
  private readonly declared = new Set<string>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.connection = await amqp.connect(this.config.get('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'));
    this.publisher = await this.connection.createChannel();
    this.connection.on('error', (error) => this.logger.error(`RabbitMQ connection error: ${error.message}`));
    this.connection.on('close', () => this.logger.error('RabbitMQ connection closed; restart the worker process after broker recovery'));
  }

  async onModuleDestroy() {
    await Promise.all(this.consumerChannels.map((channel) => channel.close().catch(() => undefined)));
    await this.publisher?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  async publish<T>(queue: string, type: string, payload: T) {
    await this.declare(queue);
    const message: Envelope<T> = { type, payload, attempt: 0 };
    if (!this.publisher.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true, contentType: 'application/json' })) {
      await new Promise<void>((resolve) => this.publisher.once('drain', resolve));
    }
  }

  async consume<T>(queue: string, handler: (message: Envelope<T>) => Promise<void>, options: ConsumerOptions = {}) {
    await this.declare(queue);
    const channel = await this.connection.createChannel();
    this.consumerChannels.push(channel);
    await channel.prefetch(options.concurrency ?? 1);
    await channel.consume(queue, async (raw) => {
      if (!raw) return;
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
      } catch (error: any) {
        const attempt = message.attempt + 1;
        const maxAttempts = options.attempts ?? 5;
        if (attempt >= maxAttempts) {
          channel.sendToQueue(`${queue}.dead`, Buffer.from(JSON.stringify({ ...message, attempt })), { persistent: true, contentType: 'application/json' });
          this.logger.error(`Message ${message.type} moved to ${queue}.dead after ${attempt} attempts: ${error.message}`);
        } else {
          const delay = (options.retryDelayMs ?? 30_000) * 2 ** (attempt - 1);
          channel.sendToQueue(`${queue}.retry`, Buffer.from(JSON.stringify({ ...message, attempt })), { persistent: true, expiration: String(delay), contentType: 'application/json' });
          this.logger.warn(`Retrying ${message.type} from ${queue} in ${delay}ms (attempt ${attempt}): ${error.message}`);
        }
        channel.ack(raw);
      }
    }, { noAck: false });
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
    await this.publisher.assertQueue(`${queue}.retry`, { durable: true, deadLetterExchange: '', deadLetterRoutingKey: queue });
    await this.publisher.assertQueue(`${queue}.dead`, { durable: true });
    this.declared.add(queue);
  }
}

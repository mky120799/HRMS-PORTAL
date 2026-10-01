import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { RabbitMqService, LEAVE_PROCESSING_QUEUE } from '../../common/messaging/rabbitmq.service';

/** Runs durable, idempotent entitlement work outside the HTTP request path. */
@Injectable()
export class LeavesProcessor implements OnModuleInit {
  private readonly logger = new Logger(LeavesProcessor.name);

  constructor(private readonly leaves: LeavesService, private readonly rabbit: RabbitMqService) {}

  async onModuleInit() {
    await this.rabbit.consume(LEAVE_PROCESSING_QUEUE, () => this.process(), { concurrency: 1, attempts: 5, retryDelayMs: 60_000 });
  }

  async process(): Promise<void> {
    const results = await this.leaves.runScheduledEntitlements();
    this.logger.log(`Processed leave entitlements for ${results.length} tenant(s)`);
  }
}

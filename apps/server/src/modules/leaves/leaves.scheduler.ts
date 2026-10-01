import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RabbitMqService, LEAVE_PROCESSING_QUEUE } from '../../common/messaging/rabbitmq.service';

/** Registers one Redis-backed recurring job, safe when multiple API replicas boot. */
@Injectable()
export class LeavesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeavesScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly rabbit: RabbitMqService) {}

  async onModuleInit() {
    const schedule = () => {
      const now = new Date();
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 1, 17, 0));
      this.timer = setTimeout(async () => {
        await this.rabbit.publish(LEAVE_PROCESSING_QUEUE, 'scheduled-entitlements', {});
        schedule();
      }, next.getTime() - Date.now());
    };
    schedule();
    this.logger.log('Registered daily RabbitMQ leave-entitlement publication');
  }

  onModuleDestroy() { if (this.timer) clearTimeout(this.timer); }
}

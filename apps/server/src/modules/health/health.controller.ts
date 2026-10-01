import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RabbitMqService } from '../../common/messaging/rabbitmq.service';

/**
 * - GET /health        liveness: the process is up (used by container restarts).
 * - GET /health/ready  readiness: dependencies reachable (used by the load
 *   balancer so traffic only goes to instances that can serve it).
 */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMqService,
  ) {}

  @Get()
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get('ready')
  async ready() {
    const checks = await Promise.allSettled([
      this.withTimeout(this.prisma.$queryRaw`SELECT 1`),
      this.withTimeout(this.rabbit.check()),
    ]);
    const [database, rabbitmq] = checks.map((c) => (c.status === 'fulfilled' ? 'up' : 'down'));
    if (database !== 'up' || rabbitmq !== 'up') throw new ServiceUnavailableException({ message: 'Not ready', database, rabbitmq });
    return { status: 'ready', database, rabbitmq };
  }

  /**
   * Scrape this endpoint from the production monitor. RabbitMQ's management
   * plugin supplies queue depth/dead-letter alerting; this endpoint verifies
   * that application-level publishing remains available.
   */
  @Get('queues')
  async queues() {
    await this.rabbit.check();
    return { status: 'ok', rabbitmq: 'up', alertOn: ['hrms.email.dead', 'hrms.hiring.dead', 'hrms.leave-processing.dead'] };
  }

  private withTimeout<T>(p: Promise<T>, ms = 2000): Promise<T> {
    return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  }
}

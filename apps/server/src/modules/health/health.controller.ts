import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { SkipThrottle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import { Public } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EMAIL_QUEUE } from '../../common/email/email.service';

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
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue,
  ) {}

  @Get()
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get('ready')
  async ready() {
    const checks = await Promise.allSettled([
      this.withTimeout(this.prisma.$queryRaw`SELECT 1`),
      this.withTimeout(this.queue.client.then((c) => c.ping())),
    ]);
    const [database, redis] = checks.map((c) => (c.status === 'fulfilled' ? 'up' : 'down'));
    if (database !== 'up' || redis !== 'up') throw new ServiceUnavailableException({ message: 'Not ready', database, redis });
    return { status: 'ready', database, redis };
  }

  private withTimeout<T>(p: Promise<T>, ms = 2000): Promise<T> {
    return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Makes short-lived artifacts single-use across every API instance: SSO
 * exchange codes (by `jti`) and SAML assertions (by assertion ID).
 *
 * `consume()` inserts the key; the primary-key constraint makes the second
 * insert fail, so exactly one caller wins even under concurrency. Rows are only
 * needed until the artifact would have expired anyway, so expired rows are
 * pruned opportunistically.
 */
@Injectable()
export class ReplayGuardService {
  private readonly logger = new Logger(ReplayGuardService.name);
  private lastPrune = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** Returns true the first time a key is seen, false on every replay. */
  async consume(key: string, expiresAt: Date): Promise<boolean> {
    try {
      await this.prisma.authReplayGuard.create({ data: { key, expiresAt } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    void this.pruneExpired();
    return true;
  }

  private async pruneExpired() {
    if (Date.now() - this.lastPrune < 10 * 60_000) return;
    this.lastPrune = Date.now();
    try {
      await this.prisma.authReplayGuard.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (error) {
      this.logger.warn(`Could not prune replay guard: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

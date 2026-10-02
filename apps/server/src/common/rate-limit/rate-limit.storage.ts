import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import * as Sentry from '@sentry/nestjs';
import Redis from 'ioredis';

/**
 * Atomic fixed-window counter with a block period, the same semantics as the
 * in-memory ThrottlerStorageService:
 *   - while blocked: report blocked, do not count
 *   - otherwise: INCR; first hit starts the window (PEXPIRE ttl)
 *   - over the limit: start a block of `blockDuration`
 * KEYS[1] = hit counter, KEYS[2] = block marker; ARGV = ttl ms, limit, block ms.
 * Returns { hits, window ms left, blocked (0/1), block ms left }.
 */
const INCREMENT_SCRIPT = `
local blockLeft = redis.call('PTTL', KEYS[2])
if blockLeft > 0 then
  return { tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('PTTL', KEYS[1]), 1, blockLeft }
end
local hits = redis.call('INCR', KEYS[1])
local windowLeft = redis.call('PTTL', KEYS[1])
if hits == 1 or windowLeft < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  windowLeft = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, windowLeft, 1, tonumber(ARGV[3]) }
end
return { hits, windowLeft, 0, 0 }
`;

const toSeconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/**
 * Rate-limit counters shared by every API instance (Redis), so N instances do
 * not allow N× the login/MFA attempts.
 *
 * Without REDIS_URL (development, tests) counters are in memory. If Redis is
 * unreachable at runtime the instance falls back to its in-memory counters —
 * limits stay enforced per instance rather than failing open — and the error
 * is logged and reported. Production requires REDIS_URL (see config/env.ts).
 */
@Injectable()
export class RateLimitStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(RateLimitStorage.name);
  private readonly memory = new ThrottlerStorageService();
  private readonly redis: Redis | null;
  private lastErrorLog = 0;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    this.redis = url
      ? new Redis(url, {
          // Fail fast so a Redis outage degrades to in-memory limits instead of stalling requests.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2_000,
          commandTimeout: 500,
          lazyConnect: false,
        })
      : null;
    this.redis?.on('error', (error) => this.reportError(error));
  }

  /** For /health/ready: where counters currently live. */
  get backend(): 'redis' | 'memory' | 'memory-fallback' {
    if (!this.redis) return 'memory';
    return this.redis.status === 'ready' ? 'redis' : 'memory-fallback';
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    if (this.redis?.status === 'ready') {
      try {
        const prefix = `hrms:throttle:${throttlerName}:${key}`;
        const [hits, windowLeft, blocked, blockLeft] = (await this.redis.eval(
          INCREMENT_SCRIPT,
          2,
          `${prefix}:hits`,
          `${prefix}:block`,
          ttl,
          limit,
          blockDuration,
        )) as [number, number, number, number];
        return {
          totalHits: hits,
          timeToExpire: toSeconds(windowLeft),
          isBlocked: blocked === 1,
          timeToBlockExpire: toSeconds(blockLeft),
        };
      } catch (error) {
        this.reportError(error);
      }
    }
    return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  private reportError(error: unknown) {
    if (Date.now() - this.lastErrorLog < 60_000) return;
    this.lastErrorLog = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Redis rate-limit store unavailable, using per-instance counters: ${message}`);
    Sentry.captureException(error);
  }

  async onApplicationShutdown() {
    this.memory.onApplicationShutdown();
    if (this.redis) await this.redis.quit().catch(() => this.redis?.disconnect());
  }
}

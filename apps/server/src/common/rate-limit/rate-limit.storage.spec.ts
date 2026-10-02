import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { RateLimitStorage } from './rate-limit.storage';

/**
 * Redis behaviour runs when REDIS_TEST_URL is set (CI service or local
 * `redis-server`); fallback behaviour always runs.
 */
const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
const describeRedis = REDIS_TEST_URL ? describe : describe.skip;

const storageFor = (url?: string) => new RateLimitStorage(new ConfigService(url ? { REDIS_URL: url } : {}));
const key = () => `test-${randomBytes(6).toString('hex')}`;
const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe('RateLimitStorage without Redis', () => {
  it('uses in-memory counters when REDIS_URL is not set', async () => {
    const storage = storageFor();
    expect(storage.backend).toBe('memory');
    const k = key();
    expect((await storage.increment(k, 60_000, 2, 60_000, 'default')).totalHits).toBe(1);
    expect((await storage.increment(k, 60_000, 2, 60_000, 'default')).isBlocked).toBe(false);
    expect((await storage.increment(k, 60_000, 2, 60_000, 'default')).isBlocked).toBe(true);
    await storage.onApplicationShutdown();
  });

  it('falls back to in-memory limits (never unlimited) when Redis is unreachable', async () => {
    const storage = storageFor('redis://127.0.0.1:1'); // nothing listens on port 1
    jest.spyOn((storage as any).logger, 'error').mockImplementation(() => undefined);
    const k = key();
    await storage.increment(k, 60_000, 1, 60_000, 'default');
    const second = await storage.increment(k, 60_000, 1, 60_000, 'default');
    expect(second.isBlocked).toBe(true);
    expect(storage.backend).toBe('memory-fallback');
    await storage.onApplicationShutdown();
  });
});

describeRedis('RateLimitStorage with Redis', () => {
  let a: RateLimitStorage;
  let b: RateLimitStorage;

  beforeAll(async () => {
    a = storageFor(REDIS_TEST_URL);
    b = storageFor(REDIS_TEST_URL);
    await until(() => a.backend === 'redis' && b.backend === 'redis');
  });

  afterAll(async () => {
    await a.onApplicationShutdown();
    await b.onApplicationShutdown();
  });

  it('shares one counter across API instances (the whole point)', async () => {
    const k = key();
    // Limit 3 per window, attempts alternate between two "instances".
    const results = [];
    for (const storage of [a, b, a, b]) results.push(await storage.increment(k, 60_000, 3, 60_000, 'default'));
    expect(results.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
    expect(results.map((r) => r.isBlocked)).toEqual([false, false, false, true]);
  });

  it('keeps blocking for the block duration without counting further hits', async () => {
    const k = key();
    await a.increment(k, 60_000, 1, 60_000, 'default');
    const blocked = await a.increment(k, 60_000, 1, 60_000, 'default');
    const again = await b.increment(k, 60_000, 1, 60_000, 'default');
    expect(blocked.isBlocked).toBe(true);
    expect(again).toMatchObject({ isBlocked: true, totalHits: 2 });
    expect(again.timeToBlockExpire).toBeGreaterThan(55);
    expect(again.timeToBlockExpire).toBeLessThanOrEqual(60);
  });

  it('starts a new window after the TTL and unblocks after the block duration', async () => {
    const k = key();
    await a.increment(k, 200, 1, 200, 'default');
    expect((await a.increment(k, 200, 1, 200, 'default')).isBlocked).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(await a.increment(k, 200, 1, 200, 'default')).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('keeps separate counters per throttler name and key', async () => {
    const k = key();
    await a.increment(k, 60_000, 1, 60_000, 'default');
    expect((await a.increment(k, 60_000, 1, 60_000, 'other')).totalHits).toBe(1);
    expect((await a.increment(key(), 60_000, 1, 60_000, 'default')).totalHits).toBe(1);
  });
});

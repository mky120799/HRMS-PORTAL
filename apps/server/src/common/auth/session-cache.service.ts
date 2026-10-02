import { Injectable } from '@nestjs/common';

/** How long one API instance trusts an "is this session still active?" answer. */
const TTL_MS = 30_000;
const MAX_ENTRIES = 50_000;

/**
 * Per-instance cache of active sessions, used by JwtStrategy so that checking
 * the access token's session costs at most one query per session per 30 s.
 *
 * Revocations performed on this instance call `forget*()` so they apply
 * immediately here; other instances notice within the TTL. Only "active" is
 * ever cached — a revoked or unknown session is always re-checked.
 */
@Injectable()
export class SessionCacheService {
  private readonly active = new Map<string, { userId: string; until: number }>();

  isActive(sessionId: string): boolean {
    const entry = this.active.get(sessionId);
    return !!entry && entry.until > Date.now();
  }

  markActive(sessionId: string, userId: string) {
    if (this.active.size >= MAX_ENTRIES) this.active.clear();
    this.active.set(sessionId, { userId, until: Date.now() + TTL_MS });
  }

  forget(sessionId: string | null | undefined) {
    if (sessionId) this.active.delete(sessionId);
  }

  forgetUser(userId: string) {
    for (const [sessionId, entry] of this.active) {
      if (entry.userId === userId) this.active.delete(sessionId);
    }
  }
}

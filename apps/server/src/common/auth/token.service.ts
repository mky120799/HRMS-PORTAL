import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';

/**
 * Every token the system issues has a purpose. Each purpose is signed with its
 * own key derived from JWT_SECRET, and carries a `typ` claim, so a token minted
 * for one purpose (e.g. a password-reset link) can never be replayed as another
 * (e.g. an API access token). This closes "token confusion" attacks.
 */
export type TokenPurpose =
  | 'access'
  | 'refresh'
  | 'two_factor'
  | 'mfa_enroll'
  | 'step_up'
  | 'invite'
  | 'reset'
  | 'sso_state'
  | 'sso_exchange';

const LIFETIMES: Record<TokenPurpose, string> = {
  access: '15m',
  refresh: '7d',
  two_factor: '5m',
  mfa_enroll: '15m', // MFA is required by policy but not set up yet: may only enrol, nothing else
  step_up: '5m', // recent re-authentication for sensitive actions
  invite: '7d',
  reset: '1h',
  sso_state: '10m',
  sso_exchange: '60s',
};

const ISSUER = 'hrms-api';

@Injectable()
export class TokenService {
  private readonly keys: Record<TokenPurpose, string>;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    const root = config.getOrThrow<string>('JWT_SECRET');
    this.keys = Object.fromEntries(
      (Object.keys(LIFETIMES) as TokenPurpose[]).map((p) => [p, TokenService.deriveKey(root, p)]),
    ) as Record<TokenPurpose, string>;
  }

  static deriveKey(root: string, purpose: TokenPurpose): string {
    return createHmac('sha256', root).update(`hrms:jwt:${purpose}`).digest('hex');
  }

  keyFor(purpose: TokenPurpose): string {
    return this.keys[purpose];
  }

  sign(purpose: TokenPurpose, payload: Record<string, unknown>): string {
    return this.jwt.sign(
      { ...payload, typ: purpose },
      { secret: this.keys[purpose], expiresIn: LIFETIMES[purpose] as any, issuer: ISSUER, algorithm: 'HS256' },
    );
  }

  /** Verifies signature, expiry, issuer and purpose. Throws 401 on any failure. */
  verify<T extends Record<string, any>>(purpose: TokenPurpose, token: string): T & { sub: string } {
    try {
      const payload = this.jwt.verify(token, { secret: this.keys[purpose], issuer: ISSUER, algorithms: ['HS256'] });
      if (payload.typ !== purpose || typeof payload.sub !== 'string') throw new Error('wrong token type');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  lifetime(purpose: TokenPurpose): string {
    return LIFETIMES[purpose];
  }
}

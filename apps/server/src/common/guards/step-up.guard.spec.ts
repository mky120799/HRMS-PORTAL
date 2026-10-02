import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { TokenService } from '../auth/token.service';
import { StepUpGuard } from './step-up.guard';

describe('StepUpGuard', () => {
  const tokens = new TokenService(new JwtService({}), new ConfigService({ JWT_SECRET: 'y'.repeat(40) }));
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector & { getAllAndOverride: jest.Mock };
  const guard = new StepUpGuard(reflector, tokens);
  const user = { userId: 'u1', tenantId: 't1', sessionId: 's1' };

  const context = (headers: Record<string, string>) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
    }) as any;

  const stepUpToken = (claims: Record<string, unknown>) => tokens.sign('step_up', { sub: 'u1', tenantId: 't1', sid: 's1', ...claims });

  beforeEach(() => reflector.getAllAndOverride.mockReturnValue(true));

  it('ignores routes that do not require step-up', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(context({}))).toBe(true);
  });

  it('accepts a step-up token for the same user and session', () => {
    expect(guard.canActivate(context({ 'x-step-up-token': stepUpToken({}) }))).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['for another session', { sid: 's2' }],
    ['for another user', { sub: 'u2' }],
    ['for another tenant', { tenantId: 't2' }],
  ])('rejects a token %s with STEP_UP_REQUIRED', (_label, claims) => {
    const headers: Record<string, string> = claims ? { 'x-step-up-token': stepUpToken(claims) } : {};
    try {
      guard.canActivate(context(headers));
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    }
  });

  it('rejects other token purposes (an access token is not a step-up token)', () => {
    const access = tokens.sign('access', { sub: 'u1', tenantId: 't1', sid: 's1' });
    expect(() => guard.canActivate(context({ 'x-step-up-token': access }))).toThrow(ForbiddenException);
  });
});

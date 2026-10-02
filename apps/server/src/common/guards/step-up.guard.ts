import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { STEP_UP_HEADER, STEP_UP_KEY } from '../auth/decorators';
import { TokenService } from '../auth/token.service';
import type { AuthUser } from '../auth/auth-user';

/**
 * Registered globally after PermissionsGuard. Routes marked @RequireStepUp()
 * need an `x-step-up-token` issued by POST /auth/step-up to the same user and
 * the same session within the last 5 minutes. A stolen access token alone is
 * therefore not enough to change roles, payroll, SSO or security policy.
 *
 * The 403 carries `code: STEP_UP_REQUIRED` so the web app can prompt and retry.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    const header = request.headers?.[STEP_UP_HEADER];
    const token = Array.isArray(header) ? header[0] : header;
    if (!user || typeof token !== 'string' || !token) throw this.required();
    try {
      const payload = this.tokens.verify<{ sid?: string | null; tenantId?: string }>('step_up', token);
      if (payload.sub !== user.userId || payload.tenantId !== user.tenantId || (payload.sid ?? null) !== (user.sessionId ?? null)) {
        throw new Error('step-up token belongs to another session');
      }
    } catch {
      throw this.required();
    }
    return true;
  }

  private required() {
    return new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Confirm your identity to continue' });
  }
}

import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../auth/token.service';
import type { AuthUser } from '../auth/auth-user';
import { ROLES } from '../constants/domain';
import { PrismaService } from '../prisma/prisma.service';
import { SessionCacheService } from '../auth/session-cache.service';
import { RolePermissionsService } from '../auth/role-permissions.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionCacheService,
    private readonly rolePermissions: RolePermissionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: tokens.keyFor('access'),
      issuer: 'hrms-api',
      algorithms: ['HS256'],
    });
  }

  /**
   * Fail closed: only a well-formed *access* token becomes a principal. A token
   * without a tenantId must never reach a service, because Prisma treats
   * `where: { tenantId: undefined }` as "no filter".
   *
   * Access tokens are stateless for 15 minutes, but each carries its session id
   * (`sid`). Checking the session (cached for 30 s per instance, cleared
   * immediately on the instance that revokes it) means logout, "revoke session",
   * admin force-logout, password change and offboarding take effect at once on
   * that instance and within 30 seconds everywhere, instead of up to 15 minutes.
   */
  async validate(payload: any): Promise<AuthUser> {
    const valid =
      payload?.typ === 'access' &&
      typeof payload.sub === 'string' &&
      typeof payload.tenantId === 'string' &&
      payload.tenantId.length > 0 &&
      (ROLES as readonly string[]).includes(payload.role);
    if (!valid) throw new UnauthorizedException('Invalid access token');

    const sessionId = typeof payload.sid === 'string' ? payload.sid : null;
    if (sessionId && !(await this.sessionActive(sessionId, payload.sub))) {
      throw new UnauthorizedException('Session has been signed out');
    }

    const customRoleId = typeof payload.crid === 'string' ? payload.crid : null;
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      permissions: await this.rolePermissions.effective(payload.role, customRoleId, payload.tenantId),
      customRoleId,
      email: payload.email,
      name: payload.name ?? '',
      employeeId: payload.employeeId ?? null,
      sessionId,
    };
  }

  private async sessionActive(sessionId: string, userId: string): Promise<boolean> {
    if (this.sessions.isActive(sessionId)) return true;
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    const active = !!session && session.userId === userId && !session.revokedAt && session.expiresAt > new Date();
    if (active) this.sessions.markActive(sessionId, userId);
    else this.sessions.forget(sessionId);
    return active;
  }
}

import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../auth/token.service';
import type { AuthUser } from '../auth/auth-user';
import { ROLES } from '../constants/domain';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(tokens: TokenService) {
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
   */
  validate(payload: any): AuthUser {
    const valid =
      payload?.typ === 'access' &&
      typeof payload.sub === 'string' &&
      typeof payload.tenantId === 'string' &&
      payload.tenantId.length > 0 &&
      (ROLES as readonly string[]).includes(payload.role);
    if (!valid) throw new UnauthorizedException('Invalid access token');

    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
      name: payload.name ?? '',
      employeeId: payload.employeeId ?? null,
    };
  }
}

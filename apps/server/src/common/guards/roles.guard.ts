import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators';
import type { Role } from '../constants/domain';

/**
 * Registered globally after JwtAuthGuard. Routes without @Roles() are open to
 * any authenticated user; finer-grained rules (e.g. "own record or ADMIN")
 * live in the service layer. SUPER_ADMIN gets no implicit bypass — platform
 * operators use the dedicated /platform endpoints.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}

import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser } from './auth-user';
import type { Role } from '../constants/domain';
import type { Permission } from './permissions';

export const IS_PUBLIC_KEY = 'isPublic';
/** Opt a route out of the global JwtAuthGuard. Authentication is on by default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restrict a route to the given roles (checked by the global RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const PERMISSIONS_KEY = 'permissions';
/** Restrict a route to users with at least one of the given permissions. */
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const STEP_UP_KEY = 'requireStepUp';
export const STEP_UP_HEADER = 'x-step-up-token';
/**
 * Sensitive action: besides the normal permission, the caller must have
 * re-authenticated (MFA code, or password when MFA is off) within the last
 * 5 minutes on this session. Checked by the global StepUpGuard.
 */
export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true);

/** Injects the verified principal: `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user as AuthUser;
});

/** Injects the cached tenant snapshot loaded by TenantAccessGuard. */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().tenant;
});

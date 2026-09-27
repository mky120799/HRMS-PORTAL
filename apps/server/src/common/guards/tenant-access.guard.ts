import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service';
import { ipMatchesAny } from '../utils/ip-match';
import type { AuthUser } from '../auth/auth-user';

/**
 * Registered globally *after* JwtAuthGuard so `request.user` is populated.
 * - Rejects users of suspended tenants.
 * - Enforces the tenant's IP allow-list (exact IPs or IPv4 CIDR ranges).
 * - Attaches the tenant snapshot to `request.tenant` for downstream guards.
 *
 * Client IP comes from `request.ip`, which honours X-Forwarded-For only when
 * TRUST_PROXY=true (i.e. behind our own load balancer).
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(private readonly tenants: TenantContextService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (!user) return true; // public route

    const tenant = await this.tenants.get(user.tenantId);
    if (!tenant || !tenant.isActive) {
      throw new ForbiddenException('This workspace is suspended. Contact support.');
    }
    if (tenant.whitelistedIps.length > 0 && !ipMatchesAny(request.ip, tenant.whitelistedIps)) {
      throw new ForbiddenException('Access from this network is not allowed for your workspace');
    }
    request.tenant = tenant;
    return true;
  }
}

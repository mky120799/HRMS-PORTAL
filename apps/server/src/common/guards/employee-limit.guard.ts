import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { employeeLimit, effectivePlan } from '../subscription/subscription-plans';
import type { TenantSnapshot } from '../tenant/tenant-context.service';

/**
 * Applied to routes that create employees. Counts only non-exited employees so
 * offboarding frees a seat. (A concurrent burst can overshoot by a few seats;
 * that is acceptable for a soft commercial limit.)
 */
@Injectable()
export class EmployeeLimitGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const tenant = context.switchToHttp().getRequest().tenant as TenantSnapshot | undefined;
    if (!tenant) throw new ForbiddenException('Tenant context is missing');

    const limit = employeeLimit(tenant);
    if (limit === Infinity) return true;

    const current = await this.prisma.employee.count({ where: { tenantId: tenant.id, status: { not: 'EXITED' } } });
    if (current >= limit) {
      throw new ForbiddenException({
        message: `Your ${effectivePlan(tenant)} plan allows ${limit} active employees. Upgrade to add more.`,
        code: 'EMPLOYEE_LIMIT_REACHED',
      });
    }
    return true;
  }
}

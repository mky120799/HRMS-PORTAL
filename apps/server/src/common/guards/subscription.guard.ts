import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SubscriptionPlan } from '@prisma/client';
import { PLAN_KEY } from '../decorators/plan.decorator';
import { effectivePlan, planMeetsRequirement } from '../subscription/subscription-plans';
import type { TenantSnapshot } from '../tenant/tenant-context.service';

/**
 * Registered globally after TenantAccessGuard (which loads `request.tenant`).
 * Only acts on routes annotated with @RequiresPlan().
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<SubscriptionPlan>(PLAN_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;

    const tenant = context.switchToHttp().getRequest().tenant as TenantSnapshot | undefined;
    if (!tenant) throw new ForbiddenException('Tenant context is missing');

    const plan = effectivePlan(tenant);
    if (planMeetsRequirement(plan, required)) return true;

    throw new ForbiddenException({
      message: `This feature requires the ${required} plan. Your workspace is on ${plan}.`,
      code: 'PLAN_UPGRADE_REQUIRED',
      requiredPlan: required,
    });
  }
}

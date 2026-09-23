import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { PLAN_KEY } from '../decorators/plan.decorator';
import {
  SubscriptionPlan,
  SubscriptionStatus,
  planMeetsRequirement,
} from '../subscription/subscription-plans';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Check if a plan requirement exists on this route
    const requiredPlan = this.reflector.getAllAndOverride<SubscriptionPlan>(
      PLAN_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No plan restriction on this route — allow freely
    if (!requiredPlan) return true;

    // 2. Extract tenantId from the JWT (req.user is set by JwtAuthGuard)
    const { user } = context.switchToHttp().getRequest();
    if (!user?.tenantId) {
      throw new ForbiddenException('Tenant context is missing');
    }

    // 3. Fetch tenant's current subscription from DB
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        subscriptionPlan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
      },
    });

    if (!tenant) {
      throw new ForbiddenException('Tenant not found');
    }

    const { subscriptionPlan, subscriptionStatus, trialEndsAt } = tenant;

    // 4. TRIAL logic — during an active trial, allow access to ALL features
    if (
      subscriptionStatus === SubscriptionStatus.TRIAL &&
      trialEndsAt &&
      new Date() < trialEndsAt
    ) {
      return true; // Trial is still valid — full access granted
    }

    // 5. Reject CANCELED or expired TRIAL accounts entirely
    if (
      subscriptionStatus === SubscriptionStatus.CANCELED ||
      (subscriptionStatus === SubscriptionStatus.TRIAL && (!trialEndsAt || new Date() >= trialEndsAt))
    ) {
      throw new ForbiddenException(
        'Your trial has expired or subscription has been canceled. Please subscribe to continue using this feature.',
      );
    }

    // 6. For ACTIVE / PAST_DUE — check if their plan meets the requirement
    if (planMeetsRequirement(subscriptionPlan, requiredPlan)) {
      return true;
    }

    // 7. Insufficient plan — provide a helpful upgrade message
    throw new ForbiddenException(
      `Your current plan (${subscriptionPlan}) does not include this feature. ` +
        `Please upgrade to ${requiredPlan} or higher to access it.`,
    );
  }
}

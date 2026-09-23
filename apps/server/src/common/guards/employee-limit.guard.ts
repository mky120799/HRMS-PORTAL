import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SubscriptionPlan,
  SubscriptionStatus,
  PLAN_EMPLOYEE_LIMITS,
} from '../subscription/subscription-plans';

@Injectable()
export class EmployeeLimitGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user, method } = context.switchToHttp().getRequest();

    // Only apply this check on POST (create) requests
    if (method !== 'POST') return true;

    if (!user?.tenantId) {
      throw new ForbiddenException('Tenant context is missing');
    }

    // Fetch tenant plan info
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

    // During an active trial — allow unlimited employees
    if (
      tenant.subscriptionStatus === SubscriptionStatus.TRIAL &&
      tenant.trialEndsAt &&
      new Date() < tenant.trialEndsAt
    ) {
      return true;
    }

    // Get plan-based employee limit
    const plan = (tenant.subscriptionPlan as SubscriptionPlan) ?? SubscriptionPlan.FREE;
    const limit = PLAN_EMPLOYEE_LIMITS[plan];

    // Unlimited (ENTERPRISE plan)
    if (limit === Infinity) return true;

    // Count current employees for this tenant
    const currentCount = await this.prisma.employee.count({
      where: { tenantId: user.tenantId },
    });

    if (currentCount >= limit) {
      throw new ForbiddenException(
        `You have reached the ${limit}-employee limit for the ${plan} plan. ` +
          `Please upgrade your plan to add more employees.`,
      );
    }

    return true;
  }
}

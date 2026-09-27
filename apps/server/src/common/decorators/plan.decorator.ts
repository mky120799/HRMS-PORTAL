import { SetMetadata } from '@nestjs/common';
import type { SubscriptionPlan } from '@prisma/client';

export const PLAN_KEY = 'required_plan';

/**
 * Minimum plan required for a route (enforced by the global SubscriptionGuard).
 * @example @RequiresPlan('BUSINESS')
 */
export const RequiresPlan = (plan: SubscriptionPlan) => SetMetadata(PLAN_KEY, plan);

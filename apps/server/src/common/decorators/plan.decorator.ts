import { SetMetadata } from '@nestjs/common';
import { SubscriptionPlan } from '../subscription/subscription-plans';

/**
 * Metadata key used by SubscriptionGuard to read the required plan.
 */
export const PLAN_KEY = 'required_plan';

/**
 * Route decorator that sets the minimum subscription plan required to access an endpoint.
 * Must be used together with SubscriptionGuard.
 *
 * @example
 * @UseGuards(JwtAuthGuard, SubscriptionGuard)
 * @RequiresPlan(SubscriptionPlan.BASIC)
 * @Get()
 * findAll() { ... }
 */
export const RequiresPlan = (plan: SubscriptionPlan) =>
  SetMetadata(PLAN_KEY, plan);

/**
 * Subscription plan definitions, hierarchy, limits and the access policy.
 * Single source of truth — used by guards, the billing module and the Stripe webhook.
 */
import { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';

export { SubscriptionPlan, SubscriptionStatus };

/** Higher index = higher tier. */
export const PLAN_ORDER: SubscriptionPlan[] = [
  SubscriptionPlan.FREE,
  SubscriptionPlan.BASIC,
  SubscriptionPlan.BUSINESS,
  SubscriptionPlan.ENTERPRISE,
];

export const PAID_PLANS = [SubscriptionPlan.BASIC, SubscriptionPlan.BUSINESS, SubscriptionPlan.ENTERPRISE] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export function planMeetsRequirement(tenantPlan: SubscriptionPlan, requiredPlan: SubscriptionPlan): boolean {
  const tenantIndex = PLAN_ORDER.indexOf(tenantPlan);
  return tenantIndex >= 0 && tenantIndex >= PLAN_ORDER.indexOf(requiredPlan);
}

export const PLAN_EMPLOYEE_LIMITS: Record<SubscriptionPlan, number> = {
  FREE: 10,
  BASIC: 50,
  BUSINESS: 250,
  ENTERPRISE: Infinity,
};

/** Employee cap while a trial is running — generous, but not unbounded. */
export const TRIAL_EMPLOYEE_LIMIT = 250;

export interface SubscriptionState {
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
}

export function isTrialActive(t: SubscriptionState, now = new Date()): boolean {
  return t.subscriptionStatus === 'TRIAL' && !!t.trialEndsAt && now < t.trialEndsAt;
}

/**
 * The plan whose features the tenant can use right now:
 * - active trial            → ENTERPRISE (full product preview)
 * - ACTIVE / PAST_DUE       → the purchased plan (PAST_DUE is Stripe's dunning grace period)
 * - expired trial / CANCELED → FREE
 */
export function effectivePlan(t: SubscriptionState, now = new Date()): SubscriptionPlan {
  if (isTrialActive(t, now)) return SubscriptionPlan.ENTERPRISE;
  if (t.subscriptionStatus === 'ACTIVE' || t.subscriptionStatus === 'PAST_DUE') return t.subscriptionPlan;
  return SubscriptionPlan.FREE;
}

export function employeeLimit(t: SubscriptionState, now = new Date()): number {
  if (isTrialActive(t, now)) return TRIAL_EMPLOYEE_LIMIT;
  return PLAN_EMPLOYEE_LIMITS[effectivePlan(t, now)];
}

/** Maps a Stripe subscription status onto ours. */
export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return SubscriptionStatus.ACTIVE;
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return SubscriptionStatus.PAST_DUE;
    default: // canceled, incomplete_expired, paused
      return SubscriptionStatus.CANCELED;
  }
}

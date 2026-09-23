/**
 * Subscription plan definitions, hierarchy, and feature limits.
 * Single source of truth — used by guards, services, and stripe webhook handler.
 */

export enum SubscriptionPlan {
  FREE = 'FREE',
  BASIC = 'BASIC',
  BUSINESS = 'BUSINESS',
  ENTERPRISE = 'ENTERPRISE',
}

export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
}

/**
 * Hierarchy order — higher index = higher tier.
 * Used to check if a tenant's plan meets the required minimum.
 */
export const PLAN_ORDER: SubscriptionPlan[] = [
  SubscriptionPlan.FREE,
  SubscriptionPlan.BASIC,
  SubscriptionPlan.BUSINESS,
  SubscriptionPlan.ENTERPRISE,
];

/**
 * Returns true if the tenant's plan meets or exceeds the required plan.
 * Example: planMeetsRequirement('BUSINESS', 'BASIC') → true
 */
export function planMeetsRequirement(
  tenantPlan: string,
  requiredPlan: SubscriptionPlan,
): boolean {
  const tenantIndex = PLAN_ORDER.indexOf(tenantPlan as SubscriptionPlan);
  const requiredIndex = PLAN_ORDER.indexOf(requiredPlan);
  return tenantIndex >= requiredIndex;
}

/**
 * Maximum number of employees allowed per plan.
 * FREE = 10, BASIC = 50, BUSINESS = 250, ENTERPRISE = unlimited (Infinity).
 */
export const PLAN_EMPLOYEE_LIMITS: Record<SubscriptionPlan, number> = {
  [SubscriptionPlan.FREE]: 10,
  [SubscriptionPlan.BASIC]: 50,
  [SubscriptionPlan.BUSINESS]: 250,
  [SubscriptionPlan.ENTERPRISE]: Infinity,
};

/**
 * Maps Stripe Price IDs (from env) to SubscriptionPlan.
 * Set the corresponding env vars in your .env file:
 *   STRIPE_PRICE_BASIC=price_xxxxx
 *   STRIPE_PRICE_BUSINESS=price_xxxxx
 *   STRIPE_PRICE_ENTERPRISE=price_xxxxx
 */
export function getPlanFromPriceId(
  priceId: string,
  env: NodeJS.ProcessEnv,
): SubscriptionPlan {
  if (priceId === env.STRIPE_PRICE_ENTERPRISE) return SubscriptionPlan.ENTERPRISE;
  if (priceId === env.STRIPE_PRICE_BUSINESS) return SubscriptionPlan.BUSINESS;
  if (priceId === env.STRIPE_PRICE_BASIC) return SubscriptionPlan.BASIC;
  return SubscriptionPlan.FREE; // Fallback
}

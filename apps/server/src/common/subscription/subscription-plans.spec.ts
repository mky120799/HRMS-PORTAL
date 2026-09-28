import { effectivePlan, employeeLimit, mapStripeStatus, planMeetsRequirement } from './subscription-plans';

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe('subscription policy', () => {
  it('gives full access during an active trial and FREE after it expires', () => {
    expect(effectivePlan({ subscriptionPlan: 'FREE', subscriptionStatus: 'TRIAL', trialEndsAt: future })).toBe('ENTERPRISE');
    expect(effectivePlan({ subscriptionPlan: 'FREE', subscriptionStatus: 'TRIAL', trialEndsAt: past })).toBe('FREE');
  });

  it('keeps the paid plan during Stripe dunning (PAST_DUE) and drops to FREE on cancel', () => {
    expect(effectivePlan({ subscriptionPlan: 'BUSINESS', subscriptionStatus: 'PAST_DUE', trialEndsAt: null })).toBe('BUSINESS');
    expect(effectivePlan({ subscriptionPlan: 'BUSINESS', subscriptionStatus: 'CANCELED', trialEndsAt: null })).toBe('FREE');
  });

  it('orders plans', () => {
    expect(planMeetsRequirement('BUSINESS', 'BASIC')).toBe(true);
    expect(planMeetsRequirement('BASIC', 'BUSINESS')).toBe(false);
  });

  it('limits seats by plan', () => {
    expect(employeeLimit({ subscriptionPlan: 'BASIC', subscriptionStatus: 'ACTIVE', trialEndsAt: null })).toBe(50);
    expect(employeeLimit({ subscriptionPlan: 'ENTERPRISE', subscriptionStatus: 'ACTIVE', trialEndsAt: null })).toBe(Infinity);
  });

  it('maps every Stripe status', () => {
    expect(mapStripeStatus('active')).toBe('ACTIVE');
    expect(mapStripeStatus('trialing')).toBe('ACTIVE');
    expect(mapStripeStatus('past_due')).toBe('PAST_DUE');
    expect(mapStripeStatus('unpaid')).toBe('PAST_DUE');
    expect(mapStripeStatus('canceled')).toBe('CANCELED');
    expect(mapStripeStatus('incomplete_expired')).toBe('CANCELED');
  });
});

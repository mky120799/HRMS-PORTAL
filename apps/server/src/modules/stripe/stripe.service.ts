import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SubscriptionPlan } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { mapStripeStatus, PAID_PLANS, type PaidPlan } from '../../common/subscription/subscription-plans';
import type { AuthUser } from '../../common/auth/auth-user';

/**
 * Stripe billing. Principles:
 *  - The client chooses a *plan name*; the server maps it to a price id and
 *    builds the redirect URLs. Clients can never pick arbitrary prices or
 *    redirect Stripe to an attacker's site.
 *  - Stripe is the source of truth for subscription state; we only mirror it
 *    from signed webhooks, never from the browser's "success" redirect.
 *  - Webhooks are idempotent (StripeEvent table) because Stripe retries.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private readonly prices: Record<PaidPlan, string | undefined>;
  private readonly frontendUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key) : null;
    this.prices = {
      BASIC: config.get('STRIPE_PRICE_BASIC'),
      BUSINESS: config.get('STRIPE_PRICE_BUSINESS'),
      ENTERPRISE: config.get('STRIPE_PRICE_ENTERPRISE'),
    };
    this.frontendUrl = config.get('FRONTEND_URL', 'http://localhost:5173');
  }

  plans() {
    return PAID_PLANS.map((plan) => ({ plan, available: !!this.stripe && !!this.prices[plan] }));
  }

  planForPrice(priceId: string | undefined): SubscriptionPlan {
    const match = PAID_PLANS.find((p) => this.prices[p] && this.prices[p] === priceId);
    if (!match) this.logger.error(`Unknown Stripe price ${priceId}; falling back to FREE`);
    return match ?? SubscriptionPlan.FREE;
  }

  async createCheckout(user: AuthUser, plan: PaidPlan) {
    const stripe = this.requireStripe();
    const price = this.prices[plan];
    if (!price) throw new BadRequestException(`The ${plan} plan is not available for purchase`);

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    if (tenant.stripeSubscriptionId && tenant.subscriptionStatus !== 'CANCELED') {
      throw new ConflictException('You already have a subscription. Use "Manage billing" to change plans.');
    }

    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create(
        { name: tenant.name, email: user.email, metadata: { tenantId: tenant.id } },
        { idempotencyKey: `customer-${tenant.id}` },
      );
      customerId = customer.id;
      await this.prisma.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: customerId } });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: tenant.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { tenantId: tenant.id } },
      allow_promotion_codes: true,
      success_url: `${this.frontendUrl}/billing?status=success`,
      cancel_url: `${this.frontendUrl}/billing?status=cancelled`,
    });
    return { url: session.url };
  }

  async createPortal(user: AuthUser) {
    const stripe = this.requireStripe();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    if (!tenant.stripeCustomerId) throw new BadRequestException('No billing account yet — choose a plan first');
    const session = await stripe.billingPortal.sessions.create({ customer: tenant.stripeCustomerId, return_url: `${this.frontendUrl}/billing` });
    return { url: session.url };
  }

  async handleWebhook(signature: string | undefined, rawBody: Buffer | undefined) {
    const stripe = this.requireStripe();
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new ServiceUnavailableException('Stripe webhook secret not configured');
    if (!signature || !rawBody) throw new BadRequestException('Missing signature or body');

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err: any) {
      this.logger.warn(`Rejected Stripe webhook: ${err.message}`);
      throw new BadRequestException('Invalid signature');
    }

    if (await this.prisma.stripeEvent.findUnique({ where: { id: event.id } })) return { received: true, duplicate: true };

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.client_reference_id && typeof session.subscription === 'string') {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await this.syncSubscription(sub, session.client_reference_id);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.syncSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        this.logger.debug(`Ignoring Stripe event ${event.type}`);
    }

    try {
      await this.prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return { received: true };
  }

  /** Mirrors a Stripe subscription onto the tenant. Safe to call repeatedly (idempotent). */
  private async syncSubscription(sub: Stripe.Subscription, tenantIdHint?: string) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const tenant =
      (tenantIdHint && (await this.prisma.tenant.findUnique({ where: { id: tenantIdHint } }))) ||
      (await this.prisma.tenant.findFirst({ where: { OR: [{ stripeSubscriptionId: sub.id }, { stripeCustomerId: customerId }] } }));
    if (!tenant) {
      this.logger.error(`No tenant for Stripe subscription ${sub.id} / customer ${customerId}`);
      return;
    }
    const status = mapStripeStatus(sub.status);
    const plan = status === 'CANCELED' ? tenant.subscriptionPlan : this.planForPrice(sub.items.data[0]?.price?.id);
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: status === 'CANCELED' ? null : sub.id,
        subscriptionStatus: status,
        subscriptionPlan: plan,
        ...(status === 'ACTIVE' ? { trialEndsAt: null } : {}),
      },
    });
    this.tenantContext.invalidate(tenant.id);
    await this.audit.log({
      tenantId: tenant.id,
      action: 'SUBSCRIPTION_SYNC',
      resource: 'billing',
      resourceId: sub.id,
      oldValues: { plan: tenant.subscriptionPlan, status: tenant.subscriptionStatus },
      newValues: { plan, status, stripeStatus: sub.status },
    });
  }

  private requireStripe(): Stripe {
    if (!this.stripe) throw new ServiceUnavailableException('Billing is not configured for this deployment');
    return this.stripe;
  }
}

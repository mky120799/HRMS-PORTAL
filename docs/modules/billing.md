# Billing (Stripe)

`apps/server/src/modules/stripe` · `common/subscription/subscription-plans.ts` · `common/guards/subscription.guard.ts`

## Plans

| Plan | Seats | Adds |
| --- | --- | --- |
| FREE | 10 | Core: employees, leave, attendance, notifications |
| BASIC | 50 | Payroll, documents, hiring |
| BUSINESS | 250 | Performance, analytics |
| ENTERPRISE | unlimited | AI screening & assistant |
| Trial (30 days) | 250 | Everything (effective plan = ENTERPRISE) |

**Effective plan** (`effectivePlan()`): active trial → ENTERPRISE; `ACTIVE` or `PAST_DUE` →
purchased plan (PAST_DUE is Stripe's dunning grace period); expired trial or `CANCELED` → FREE.
Routes declare `@RequiresPlan('BASIC')` etc.; the global `SubscriptionGuard` returns 403
`PLAN_UPGRADE_REQUIRED` which the UI turns into an upgrade prompt.

## Endpoints

| Method & path | Access |
| --- | --- |
| `GET /billing/plans` | user — which plans are purchasable in this deployment |
| `POST /billing/checkout` `{ plan }` | `tenant.billing.manage` — Stripe Checkout URL |
| `POST /billing/portal` | `tenant.billing.manage` — Stripe Customer Portal (change plan, card, invoices, cancel) |
| `POST /stripe/webhook` | Stripe only (signature-verified), no JWT, no throttling |

## Rules
* The client sends a **plan name**; price ids and redirect URLs come from server config.
  (The original accepted arbitrary price ids and redirect URLs from the browser.)
* **Stripe is the source of truth.** The tenant's plan changes only from **signed webhooks**
  (`checkout.session.completed`, `customer.subscription.created|updated|deleted`), never from
  the browser's success redirect.
* **Idempotent webhooks:** processed event ids are stored in `StripeEvent`; Stripe retries are
  no-ops. Sync logic is itself idempotent (sets state, doesn't increment).
* Status mapping (`mapStripeStatus`): active/trialing → ACTIVE; past_due/unpaid/incomplete →
  PAST_DUE; everything else → CANCELED.
* Customer creation uses an idempotency key per tenant. The tenant cache is invalidated after
  each sync; every change is audited (`SUBSCRIPTION_SYNC`).

## Setup
Create products/prices in Stripe, set `STRIPE_PRICE_*`, point a webhook at
`https://<domain>/api/v1/stripe/webhook` with the four events above, and set
`STRIPE_WEBHOOK_SECRET`. Test locally with `stripe listen --forward-to localhost:3000/api/v1/stripe/webhook`.

# Tenants module

`apps/server/src/modules/tenants` · `common/tenant/tenant-context.service.ts` · `common/guards/tenant-access.guard.ts`

## Purpose
Workspace settings, subscription status for the UI, and first-run sample data.

## Data
`Tenant`: `name`, `slug` (unique, public identifier), `timezone` (IANA), `isActive`
(platform suspension), `whitelistedIps` (IPs/CIDRs), `slackWebhookUrlEnc`,
`slackHiringWebhookEnc` (encrypted), `demoSeededAt`, Stripe ids, `subscriptionPlan`,
`subscriptionStatus`, `trialEndsAt`.

## Endpoints

| Method & path | Access | Notes |
| --- | --- | --- |
| `GET /tenants/subscription` | user | Plan, status, **effective plan**, trial days left, seats used / limit |
| `GET /tenants/settings` | ADMIN | Webhook URLs are returned **masked** (write-only secrets) |
| `PATCH /tenants/settings` | ADMIN | name, timezone, IP allow-list, Slack webhooks (`null` clears) |
| `POST /tenants/seed-demo` | ADMIN | Once, only for an empty workspace |

## Rules
* **Tenant snapshot cache.** `TenantAccessGuard` runs on every authenticated request and needs
  `isActive`, `whitelistedIps` and plan fields. `TenantContextService` caches them for 30 s per
  tenant; writes call `invalidate()`. Other instances converge within 30 s — the documented
  bound on how long a revoked IP or suspended tenant keeps access.
* **IP allow-list** supports exact IPv4/IPv6 and IPv4 CIDR. The client IP is `request.ip`,
  which trusts `X-Forwarded-For` only when `TRUST_PROXY=true` (behind our ALB/nginx), so it
  cannot be spoofed by clients. **Lock-out protection:** an admin cannot save a list that
  excludes their current IP.
* **Slack webhooks** must match `https://hooks.slack.com/services/…` — anything else would let
  an admin make our servers call arbitrary URLs (SSRF, e.g. cloud metadata endpoints).
  Stored encrypted.
* **Timezone** validated with `Intl`. Drives attendance "today" and analytics.
* **Demo seeder** (`tenant-demo-seeder.service.ts`): 20 employees in 5 departments with managers,
  salaries, 30 days of attendance, 3 finalized payroll months (computed with the real payroll
  calculator), leave history, jobs + applications and completed reviews — all in **one
  transaction**. It **never changes billing** (the original upgraded tenants to a paid plan for
  free) and refuses if the workspace already has data.

## Tests
Security suite: allow-list enforcement, lock-out refusal, SSRF-safe webhook validation,
seed-once + plan unchanged. Unit: `ip-match.spec.ts`.

## Interview talking points
* Cache invalidation trade-off (30 s TTL vs a Redis pub/sub invalidation).
* Why validate webhook hosts — SSRF is in the OWASP Top 10 (A10:2021).

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
| `GET /tenants/settings` | `tenant.settings.manage` | Webhook URLs are returned **masked** (write-only secrets) |
| `PATCH /tenants/settings` | `tenant.settings.manage` | name, timezone, IP allow-list, Slack webhooks (`null` clears) |
| `GET /tenants/auth-policy` | `security.manage` | Reads tenant login, MFA, password and session policy |
| `PATCH /tenants/auth-policy` | `security.manage` | Updates login methods, MFA enforcement, password history/expiry and session limits |
| `GET /tenants/identity-providers` | `security.manage` | Lists OIDC/SAML provider configuration with secrets masked |
| `POST /tenants/identity-providers` | `security.manage` | Stores OIDC/SAML setup data; OIDC is used by `/auth/oidc/start/:providerId` |
| `PATCH /tenants/identity-providers/:id` | `security.manage` | Updates or disables a configured provider |
| `POST /tenants/identity-providers/:id/scim-token` | `security.manage` | Rotates the provider SCIM bearer token and returns it once |
| `POST /tenants/seed-demo` | `tenant.settings.manage` | Once, only for an empty workspace |

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
* **Auth policy** is tenant-specific. It controls whether password/Google login
  is allowed, MFA enforcement, password minimum length, password history count,
  password expiry, session idle timeout and absolute session lifetime. MFA
  enforcement refuses to save until affected active users are already enrolled.
* **Enterprise SSO configuration** supports OIDC/SAML setup records with
  encrypted client secrets/certificates and masked reads. OIDC and SAML runtime
  sign-in are active for configured providers. SCIM bearer tokens are stored as
  hashes and can be rotated from Settings.
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

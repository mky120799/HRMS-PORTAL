# Production readiness plan

Status as of 2026-09-28 (branch `production-hardening`).

## 1. Audit findings → fixes

### P0 — Security (all fixed, each covered by a test in `test/security.e2e-spec.ts`)

| # | Finding in the original code | Fix |
| --- | --- | --- |
| 1 | `POST /auth/register` was public and created an **ADMIN in any tenant** given its id; `GET /public/jobs` leaked every tenant id | Endpoint removed; users join only via admin invite. Careers pages are per-slug and never expose ids |
| 2 | Google SSO signed in by email across all tenants and **auto-provisioned unknown Google users into the first tenant** | SSO requires an existing active user in the workspace named in a signed `state`; verified email only; no provisioning; tokens never in URLs |
| 3 | All tokens (refresh, reset, invite, 2FA) accepted as access tokens → **2FA bypass** and **cross-tenant reads** (`tenantId: undefined` disables Prisma filters) | Purpose-bound `TokenService` (per-purpose keys + `typ`); `JwtStrategy` fails closed without tenant/role |
| 4 | Default secrets (`super-secret-default-key`, internal secret never configured) made `/internal/*` public | No secret defaults; env validated at boot; internal endpoints deleted |
| 5 | Any employee could send arbitrary HTML email from the company domain | Admin-only, recipients limited to workspace members, sanitised HTML |
| 6 | Any user could call `seed-demo` to get a **free BUSINESS plan** | Admin-only, once, empty workspace only, never touches billing |
| 7 | Cross-tenant IDOR on application status, interview scheduling, manager reviews | Every lookup scoped by tenant; 404 for foreign ids |
| 8 | Password-reset links stored in a table **every employee could list** | Credential emails stored redacted; users only see their own notifications |
| 9 | Reset/invite links reusable; password change kept old sessions | `tokenVersion` makes links single-use and revokes sessions |
| 10 | Refresh tokens hashed with bcrypt (72-byte truncation → any token matched) | SHA-256 hash, rotation, reuse detection |
| 11 | IP whitelist never ran (guard order) and matched spoofable IPs | Global `TenantAccessGuard` after auth; CIDR support; `trustProxy` only behind our proxy; lock-out protection |
| 12 | One global Slack webhook and Google Calendar account for all customers | Per-tenant encrypted Slack webhooks (SSRF-validated); interviews via calendar links, no shared account |
| 13 | CORS `*`, public Swagger, no security headers, HTTP only | CORS allow-list, Swagger off in prod, helmet + CSP/HSTS, TLS at ALB/Caddy, WAF |
| 14 | Uploads trusted client MIME type; files on container disk | Magic-byte validation; private encrypted S3 with tenant-prefixed keys |

### P0 — Deployment (all fixed)

| Finding | Fix |
| --- | --- |
| `start:prod` pointed at a file the build didn't produce → container crash | Build `rootDir` fixed; verified `dist/main.js` boots |
| Runtime dependencies (`faker`, `prisma`) were dev-only | Moved to dependencies; multi-stage image with prod deps only |
| Frontend built against `localhost:3000` in production | Correct `VITE_API_BASE_URL`; same-origin `/api/v1` |
| `prisma db push --accept-data-loss` against production | Versioned migrations only; `migrate deploy` as a gated one-off task |
| No TLS, no backups, no deletion protection, no remote state, placeholder CI role, ECS services missing | Full Terraform rewrite (see [DEPLOYMENT.md](DEPLOYMENT.md)); validated with `terraform validate` |
| No health checks | `/health` and `/health/ready`; ALB uses readiness |

### P1 — Broken features (all fixed, covered by `test/workflows.e2e-spec.ts` + Playwright)

`req.user.sub/employeeId/name` were never set → logout, 2FA, GDPR export, payslips, documents,
performance were broken and **every clock-in was recorded against the first employee**. Hiring
UI called non-existent routes. File uploads used Express interceptors on Fastify. AI "screened"
filenames and returned random scores. Checkout used a hard-coded fake price. No leave approval
UI, no salary management, fake settings and super-admin pages, failed emails marked "SENT",
payroll with flat 10 % "TDS" and floats for money. Every one of these is rewritten; see the
module docs.

### P2 — Engineering quality (done)
* 79 automated tests (previously 1 passing scaffold test): 33 unit, 43 API e2e against real Postgres/Redis, 3 browser.
* Structured JSON logs with request ids; Sentry; CloudWatch alarms.
* Pagination everywhere lists can grow; zod validation on every input.
* Audit trail for all mutations plus business events.
* Transactions for multi-step writes (signup, invite, offboarding, erasure, demo seed).
* Dependency cleanup: removed unused Express platform, duplicate Gemini SDK, Google APIs,
  dead shared package; `npm audit fix`. High advisories: 16 → 3 (the remaining 3 are the same
  Prisma CLI-only issue).

## 2. Upgrading the existing deployment

The migration `20260928000000_production_hardening` is additive and was tested against data in
the old schema (legacy rows are backfilled). What changes for existing users:

* **Everyone signs in again once.** Token signing keys changed and refresh tokens are now hashed
  differently.
* **Sign-in uses the workspace ID** (slug, shown in Settings) — the old tenant UUID still works.
* **2FA keeps working.** Secrets saved before this release are plaintext; they are accepted and
  re-encrypted automatically on the user's next successful 2FA login.
* **Old uploaded files are not migrated.** They were on the container's local disk (lost on
  every redeploy anyway); document rows without a file show "no file attached". Ask users to
  re-upload important documents.
* **Slack** is now configured per workspace in Settings (the old server-wide env vars are ignored).
* **Payroll:** salary amounts are now **monthly**. Review each salary structure before the first
  run; existing payslips are kept (PAID → FINALIZED).
* Take an RDS snapshot before applying the migration.

## 3. Go-live checklist (for your customer)

- [ ] Terraform applied in the customer's region; domain + ACM certificate + DNS in place
- [ ] SES domain verified with DKIM; SES moved out of sandbox
- [ ] Integrations secret filled (Stripe live keys + webhook, Gemini key if AI is sold, Google SSO if used)
- [ ] `ENCRYPTION_KEY` and DB credentials backed up in a password manager/vault
- [ ] Super-admin account created; test customer workspace created and walked through
- [ ] Alarm email subscription confirmed (SNS sends a confirmation email)
- [ ] A restore from RDS point-in-time tested once
- [ ] Privacy notice & DPA list sub-processors: AWS, Stripe, Google (Gemini/SSO), Slack (optional), Sentry (optional)
- [ ] Customer's leave policies, holidays, timezone and salary structures configured
- [ ] Payroll for the first month run in parallel with the customer's existing process and reconciled before relying on it

## 4. Roadmap

Ordered by value to a paying customer.

| Priority | Item | Why |
| --- | --- | --- |
| High | Statutory payroll depth: employer PF/ESI, professional-tax slabs, tax projection, bank payout file | Needed before payroll replaces the customer's existing process |
| High | Refresh token in httpOnly SameSite cookie; SSO state bound to a nonce cookie | Closes the two main residual auth risks |
| High | Redis-backed rate limiting and a small cache layer | Correct limits across multiple API instances |
| Medium | PostgreSQL Row-Level Security as a second isolation layer | Defence in depth for tenant data |
| Medium | Separate worker service for queues; dead-letter alerting | Isolate background load from API latency |
| Medium | Attendance regularisation, shifts, geo/IP office check-in | Common customer requests |
| Medium | Bulk employee import (CSV) with validation report | Faster onboarding of new customers |
| Medium | Audit logs to write-once storage (S3 Object Lock) | Tamper evidence for compliance audits |
| Low | Accessibility pass (labelled inputs, focus management), i18n | Enterprise procurement requirements |
| Low | OpenAPI-generated typed client for the web app | Removes a class of front/back contract bugs |

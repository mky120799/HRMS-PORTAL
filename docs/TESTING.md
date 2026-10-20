# Testing

| Layer | Where | What it proves | Run |
| --- | --- | --- | --- |
| Unit (130 tests) | `apps/server/src/**/*.spec.ts` | Pure logic plus hiring workflow permissions, outbox leases/retries, reminder concurrency, interview rescheduling, email idempotency/terminal failure, payroll maths, dates, security and sanitising; auth: token purposes, session checks, step-up guard, OIDC ID-token verification with real RSA keys, SAML Destination/Recipient, SSRF guard, IdP role/attribute mapping, recovery-code races, single-use TOTP, no-escalation role rules, custom-role permission resolution, Redis rate-limit storage (Redis cases need `REDIS_TEST_URL`) | `npm test` |
| API e2e — auth (19) | `apps/server/test/auth.e2e-spec.ts` | httpOnly refresh cookie, instant revocation, 2FA lockout, single-use recovery/SSO codes, required MFA enrolment, step-up, ADMIN-only IdP config, OIDC SSRF, IdP role mapping, SCIM protocol, single-use TOTP, custom roles, no-escalation (incl. invitations), SCIM groups → roles, security-event filter | `npm run test:e2e:api` |
| API e2e — security (27) | `apps/server/test/security.e2e-spec.ts` | One test per audited vulnerability: tenant isolation, token confusion, RBAC, open relay, credential-link redaction, refresh reuse, lockout, enumeration, billing integrity, IP allow-list, SSRF, upload sniffing, error envelope | `npm run test:e2e:api` |
| API e2e — workflows (19) | `apps/server/test/workflows.e2e-spec.ts` | Leave, attendance, payroll (exact figures + PDF), performance, hardened hiring workflow, assessment callback idempotency, offboarding, erasure, audit trail | same |
| Browser (3) | `apps/e2e/tests/smoke.spec.ts` | Signup → sample data → key pages; login validation; public careers page | `npm run test:e2e:ui` |

The API e2e tests boot the real Nest application in-process (`test/helpers.ts` reuses
`configureApp()` from production) and talk to real PostgreSQL and RabbitMQ services — no mocks of the
database, because tenant-scoping bugs only show up against real queries.

## Running locally
```bash
docker compose up -d --wait                       # PostgreSQL + RabbitMQ + Redis
export DATABASE_URL=postgresql://hrms:hrms@localhost:5432/hrms_test
createdb -h localhost -U hrms hrms_test || true
(cd apps/server && npx prisma migrate deploy)
RABBITMQ_URL=amqp://guest:guest@localhost:5672 JWT_SECRET=$(openssl rand -hex 32) ENCRYPTION_KEY=$(openssl rand -base64 32) npm run test:e2e:api
```
Add `REDIS_URL=redis://localhost:6379` to run the API against Redis-backed rate limits (as
CI does), and `REDIS_TEST_URL=redis://localhost:6379 npx jest src/common/rate-limit` for the
Redis storage tests. With Redis, rate-limit counters outlive the test process, so tests must
not depend on a fixed client IP.

For the browser suite: `npm run build`, `npx playwright install chromium` (in `apps/e2e`), then
`npm run test:e2e:ui` with the same environment variables.

## CI gates (`.github/workflows/ci-cd.yml`)
Typecheck (server + web) · unit tests · build · `npm audit` (critical) · migrations applied from
scratch **and** checked for drift against `schema.prisma` · API e2e · browser e2e · Docker builds
· Trivy scan · manual approval · deploy.

## Writing new tests
* Business rule with no I/O → extract a pure function, unit test it (see `payroll.calculator.ts`).
* Anything involving permissions or tenant data → add an API e2e case; create two tenants with
  `TestClient.signup()` and assert the other tenant gets 404.

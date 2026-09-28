# Testing

| Layer | Where | What it proves | Run |
| --- | --- | --- | --- |
| Unit (33 tests) | `apps/server/src/**/*.spec.ts` | Pure logic: payroll maths, dates/timezones, IP matching, plan policy, token purpose isolation, JWT fail-closed validation, encryption, legacy 2FA secrets, email escaping, HTML sanitising | `npm test` |
| API e2e — security (27) | `apps/server/test/security.e2e-spec.ts` | One test per audited vulnerability: tenant isolation, token confusion, RBAC, open relay, credential-link redaction, refresh reuse, lockout, enumeration, billing integrity, IP allow-list, SSRF, upload sniffing, error envelope | `npm run test:e2e:api` |
| API e2e — workflows (16) | `apps/server/test/workflows.e2e-spec.ts` | Leave, attendance, payroll (exact figures + PDF), performance, hiring, offboarding, erasure, audit trail | same |
| Browser (3) | `apps/e2e/tests/smoke.spec.ts` | Signup → sample data → key pages; login validation; public careers page | `npm run test:e2e:ui` |

The API e2e tests boot the real Nest application in-process (`test/helpers.ts` reuses
`configureApp()` from production) and talk to a real PostgreSQL and Redis — no mocks of the
database, because tenant-scoping bugs only show up against real queries.

## Running locally
```bash
docker compose up -d --wait                       # Postgres + Redis
export DATABASE_URL=postgresql://hrms:hrms@localhost:5432/hrms_test
createdb -h localhost -U hrms hrms_test || true
(cd apps/server && npx prisma migrate deploy)
JWT_SECRET=$(openssl rand -hex 32) ENCRYPTION_KEY=$(openssl rand -base64 32) npm run test:e2e:api
```
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

# Interview guide

How to explain this project clearly, with the reasoning behind each decision. Every claim here
points to code you can open during the interview.

## 1. The 60-second pitch

> "It's a multi-tenant HR SaaS — employees, leave, attendance, payroll with payslip PDFs,
> documents, performance reviews, a hiring pipeline with a public careers page, Stripe billing
> and optional AI screening. The backend is a NestJS modular monolith on Fastify with
> PostgreSQL/Prisma and RabbitMQ; the frontend is React with React Query. It runs on AWS ECS
> Fargate behind an ALB and WAF, provisioned with Terraform, deployed by GitHub Actions with a
> migrate-then-roll-out step.
>
> The part I'm proudest of is taking it from a demo to production: I audited it, found
> critical issues — anyone could make themselves admin of any customer, tokens could be swapped
> to read every tenant's data, the prod container couldn't even start — fixed them, and locked
> each fix in with a regression test. It now has 98 automated tests, including a security suite
> that attacks the API the way I found it could be attacked."

## 2. Architecture in five sentences
1. Modular monolith: one deployable, feature modules with controller → service → Prisma. ([ARCHITECTURE.md](ARCHITECTURE.md))
2. Shared-schema multi-tenancy: `tenantId` on every row, taken only from the verified token.
3. Global guard chain: rate limit → authenticate → tenant checks → roles → plan. Default deny.
4. Slow or flaky work (email, AI) goes through durable RabbitMQ queues with retries and dead-letter handling.
5. Stateless API containers behind a load balancer, so it scales horizontally; state lives in RDS, Amazon MQ and S3.

## 3. Key decisions and trade-offs

| Decision | Alternative | Why I chose it | Cost I accepted |
| --- | --- | --- | --- |
| Modular monolith | Microservices | Small team, shared transactions, simpler ops; boundaries make later extraction possible | One deploy unit |
| Shared schema + `tenantId` | DB/schema per tenant | Cheapest, simplest migrations, fine for SMB customers | Isolation relies on code → mitigated by fail-closed auth, scoped queries, e2e tests; RLS on roadmap |
| Stateless 15-min access JWT + stateful refresh | Server sessions | No DB hit per request; horizontal scaling | Revocation delay ≤ 15 min |
| Purpose-bound tokens | One secret for everything | Kills token-confusion bugs structurally | Slightly more code |
| `tokenVersion` revocation | Token blacklist table | One integer revokes all sessions and makes links single-use | Coarse-grained (all sessions) |
| zod over class-validator | class-validator DTOs | Schema = type, strips unknown keys, reusable on the frontend | Less Nest "magic" |
| Money in DECIMAL + integer maths | Float | Exactness; 0.1 + 0.2 bugs in payroll are unacceptable | Conversions at the edges |
| TDS entered, not computed | Hard-coded tax rate | A wrong automatic tax figure is worse than an explicit input | Payroll admin enters TDS |
| Files streamed through API | Public/pre-signed URLs | One authorisation path, audit, no leaked links | API bandwidth for downloads |
| AI advisory only | Auto-reject low scores | Legal exposure (EU AI Act, NYC LL-144) and fairness | Recruiters still decide |
| Workers in API process | Separate worker service | Simplest to run at current load | Background spikes share CPU with API (split later) |
| ECS Fargate | Kubernetes / EC2 | No cluster to manage; autoscaling and rolling deploys built in | Less control, higher per-vCPU price |

## 4. Bugs worth telling as stories

**"Undefined means everything."** Services filtered with `where: { tenantId }`. A refresh token
has no `tenantId`, and the JWT strategy didn't check the token type — so presenting a refresh
token as an access token made `tenantId` undefined, and Prisma treats an undefined filter as *no
filter*: the API returned every company's employees. Fix: purpose-bound tokens and a strategy
that fails closed. Lesson: validate the *shape* of the principal, not just the signature.

**bcrypt's 72-byte limit.** Refresh tokens were stored with bcrypt. bcrypt only reads the first 72
bytes, and every JWT from our issuer shares its header and `sub` prefix — so any old refresh
token for a user matched. Rotation silently did nothing. Fix: SHA-256 (tokens are
high-entropy, so a slow hash adds nothing) + reuse detection.

**Guard ordering.** An IP-whitelist guard was registered globally, but global guards run before
controller guards, so `request.user` was never set and the check always passed. Fix: make
authentication itself global and order the chain explicitly.

**Everyone clocked in as the same person.** Attendance looked up `employee where userId =
req.user.sub`, but the strategy set `userId`, not `sub`. `userId: undefined` → no filter →
`findFirst` returned the first employee in the tenant. Same root cause as story 1, different symptom.

## 5. Likely questions — short answers

**How do you guarantee tenant isolation?** Tenant id comes only from the verified token; the
strategy rejects tokens without it; every query is scoped; foreign ids return 404; storage keys
are tenant-prefixed; a test suite creates two tenants and attacks across them. Next layer: Postgres RLS.

**How does it scale?** API tasks are stateless → autoscale on CPU (2–10). DB: vertical + read
replicas later; indexes on `(tenantId, …)`. Analytics uses aggregates only. Queues absorb
bursts. Bottlenecks I'd watch: DB connections (Prisma `connection_limit` per task), per-instance
rate limits (move to Redis).

**How do you deploy without downtime?** Rolling ECS deploy with min healthy 100 %, readiness
checks on DB+RabbitMQ, 30 s connection draining, circuit-breaker rollback. Migrations run first as
a separate task and must be backward compatible (expand/contract).

**What happens if SES or Gemini is down?** Requests don't wait on them. Jobs retry with
exponential backoff; notification rows show FAILED after the last attempt. AI features return
503 or mark screening "review manually".

**How is payroll correct?** Pure calculator in integer minor units with unit tests for PF ceiling,
pro-ration, LOP and edge cases; draft → finalize lifecycle so nothing reaches employees until
reviewed; finalized months are locked; every salary change is audited with before/after.

**How do you handle a leaked token?** Access token ≤ 15 min. Refresh token rotation means the
attacker and user race; the first reuse of an old token revokes the session and is audited.
Password change or admin offboarding bumps `tokenVersion` and kills everything.

**GDPR/DPDP?** Self-service export, erasure after offboarding (keeping statutory payroll
records), candidate deletion, consent on applications, audit trail, encryption at rest/in transit.

**What would you do next?** httpOnly refresh cookie, Redis rate limiting, RLS, deeper statutory
payroll, separate worker service. ([PRODUCTION_PLAN.md](PRODUCTION_PLAN.md#4-roadmap))

## 6. Module one-liners
* **Auth** — purpose-bound JWTs, rotation + reuse detection, lockout, TOTP, SSO without auto-provisioning.
* **Tenants** — settings with SSRF-safe webhooks, CIDR allow-list with lock-out protection, cached tenant snapshot.
* **Employees** — field-level visibility, reporting-cycle checks, offboarding that revokes access in one transaction.
* **Leave** — server-computed working days, balance includes pending, manager-only approval, race-safe conditional update.
* **Attendance** — tenant-timezone "today", uniqueness enforced by the database, rosters for managers.
* **Payroll** — pure integer-money calculator, LOP pro-ration, draft/finalize lock, in-memory PDFs.
* **Documents** — magic-byte validation, private tenant-prefixed S3, streamed downloads.
* **Performance** — explicit state machine, reviewer assignment from reporting lines.
* **Hiring** — per-company careers page, consent, duplicate protection, escaped emails, advisory AI.
* **Notifications** — queue with retries and truthful status, redacted credential emails, no open relay.
* **Billing** — server-side price mapping, webhook-driven state, idempotent events, plan policy as pure functions.
* **Compliance/Audit/Platform** — export/erasure with legal retention, append-only audit, operators without data access.

## 7. Numbers to remember
* 17 feature modules, ~90 API routes, 16 tables.
* 79 automated tests: 33 unit · 27 security e2e · 16 workflow e2e · 3 browser.
* Access token 15 min · refresh 7 days · lockout 5 attempts / 15 min · tenant cache 30 s.
* RDS: Multi-AZ, 14-day PITR, encrypted, deletion-protected. API: 2–10 tasks at 60 % CPU target.

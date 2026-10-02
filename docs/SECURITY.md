# Security

HR systems hold the most sensitive data a company has: identity documents, salaries, health-
related leave and performance feedback. This document lists the threats considered, the
controls in place and the known residual risks.

## Threat model (summary)

| Threat | Example | Controls |
| --- | --- | --- |
| Cross-tenant data access | Company A reads Company B's employees | Tenant from verified token only; fail-closed JWT validation; every query scoped; 404 for foreign ids; tenant-prefixed storage keys; e2e isolation tests |
| Account takeover | Stolen/guessed credentials, token replay | bcrypt(12), lockout, TOTP 2FA, 15-min access tokens, refresh rotation + reuse detection, purpose-bound tokens, single-use invite/reset links |
| Privilege escalation | Employee calls admin APIs | Global default-deny auth, `@Roles`, relationship checks in services (own record / direct manager / not self), last-admin protection |
| Injection | SQL, HTML/email, prompt | Prisma parameterised queries (raw SQL via tagged templates); zod validation strips unknown keys; email templates escape; rich text sanitised; AI output schema-validated |
| Malicious uploads | Executable disguised as PDF | Magic-byte sniffing, size limits, private storage, served as attachments |
| SSRF | Webhook to cloud metadata | Slack webhooks limited to `hooks.slack.com`; no other user-supplied outbound URLs |
| Abuse of email | Phishing from the company domain | No open relay: admin-only, recipients must be workspace members |
| Billing fraud | Free plan upgrade | Plan changes only via signed, idempotent Stripe webhooks; server-side price mapping; demo seed can't touch billing |
| Brute force / DoS | Credential stuffing | Per-route rate limits, WAF rate rule + managed rule sets, body/upload limits |
| Secret leakage | Keys in repo/logs | Secrets Manager → ECS; `.env` git-ignored; no defaults for secrets; logs exclude bodies and query strings; Sentry without PII |
| Insider misuse | Admin exfiltrates data | Audit trail with IP/user agent/request id; operators can't see employee data |

## Controls by layer

**Edge:** TLS 1.2/1.3 only (ALB policy), HTTP→HTTPS redirect, AWS WAF (Common + Known Bad
Inputs + 2000 req/5 min/IP), HSTS, strict CSP (no third-party scripts), `X-Frame-Options: DENY`.

**API:** helmet headers, CORS allow-list, 1 MB JSON body limit, 10 MB multipart limit,
`@nestjs/throttler` (100/min default; 5–10/min on auth routes; 5 per 10 min on public apply),
request ids, uniform error envelope without stack traces.

**Data:** RDS encrypted, TLS forced (`rds.force_ssl`), private subnets, 14-day PITR backups,
Multi-AZ, deletion protection. Amazon MQ RabbitMQ is private, TLS-only, authenticated, encrypted at rest, and Multi-AZ. S3 private,
SSE, TLS-only bucket policy, versioning. Application-level AES-256-GCM for TOTP secrets and
Slack webhooks.

**Identity & access (cloud):** separate ECS execution and task roles; task role can only
read/write `tenants/*` in one bucket and send via one SES identity. CI deploys through GitHub
OIDC (no long-lived AWS keys) behind a manual-approval environment.

**Supply chain:** `npm audit` in CI (fails on critical), Trivy image scan (fails on critical),
ECR scan-on-push, immutable image tags, minimal runtime images running as non-root.

## Residual risks & mitigations planned

| Risk | Why accepted now | Plan |
| --- | --- | --- |
| Access tokens stay valid ≤ 15 min after revocation | Stateless verification keeps every request DB-free | Redis deny-list keyed by `jti` if needed |
| Tokens in `localStorage` | Simple SPA/API split; CSP blocks third-party script injection | Refresh token in httpOnly SameSite cookie |
| Google SSO login CSRF | `state` is signed but not bound to the browser | Bind state to an httpOnly nonce cookie |
| `sso_exchange` code reusable for 60 s | Very short TTL, single session rotation | Store `jti` in Redis for strict one-time use |
| Throttler counters are per instance | Behind WAF IP rate limit | Redis-backed throttler storage |
| No database Row-Level Security | App-layer scoping + tests | Add Postgres RLS as defence in depth |
| Prisma CLI transitive advisory (`deepmerge-ts`) | CLI-only, parses trusted local config | Upgrade when Prisma releases a patched version |

## Reporting a vulnerability
Email security@<your-domain>. Please do not open public issues for security reports.

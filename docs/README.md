# Documentation

| Document | Read it when you want to… |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | understand the system, request lifecycle, multi-tenancy, auth and data model |
| [SECURITY.md](SECURITY.md) | see threats, controls and known residual risks |
| [DEPLOYMENT.md](DEPLOYMENT.md) | deploy to AWS or a single host, roll back, rotate secrets, back up |
| [TESTING.md](TESTING.md) | run or extend the test suites |
| [PRODUCTION_PLAN.md](PRODUCTION_PLAN.md) | see what the audit found, how each issue was fixed, the go-live checklist and roadmap |
| [INTERVIEW_GUIDE.md](INTERVIEW_GUIDE.md) | explain the project and its trade-offs |

## Modules

| Module | Summary |
| --- | --- |
| [Auth](modules/auth.md) | Sign-up, login, sessions, invites, reset, 2FA, Google SSO |
| [Tenants](modules/tenants.md) | Workspace settings, IP allow-list, Slack, sample data |
| [Employees](modules/employees.md) | Directory, reporting lines, offboarding, roles |
| [Leave](modules/leave.md) | Policies, holidays, requests, balances, approvals |
| [Attendance](modules/attendance.md) | Clock-in/out, rosters |
| [Payroll](modules/payroll.md) | Salary structures, payroll runs, payslip PDFs |
| [Documents](modules/documents.md) | Private employee documents with expiry |
| [Performance](modules/performance.md) | Review cycles |
| [Hiring](modules/hiring.md) | Careers page, pipeline, interviews |
| [AI](modules/ai.md) | Resume screening/parsing, HR assistant |
| [Notifications](modules/notifications.md) | Email pipeline, inbox, announcements |
| [Billing](modules/billing.md) | Plans, Stripe checkout/portal, webhooks |
| [Analytics](modules/analytics.md) | Dashboard KPIs |
| [Compliance](modules/compliance.md) | Data export and erasure |
| [Audit](modules/audit.md) | Audit trail |
| [Platform & health](modules/platform.md) | Operator console, health checks |

Interactive API reference: run the API locally and open `http://localhost:3000/api/docs`.

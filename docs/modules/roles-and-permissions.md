# Roles and permissions

The portal now uses built-in roles mapped to explicit permissions. Routes should
check permissions for day-to-day product access, while role checks are kept only
where the role identity itself matters, such as platform-only access or
protecting the last tenant administrator.

This is closer to how mature HR systems work: users receive a job-oriented role,
and the code checks the exact capability required by each action.

## Built-in roles

| Role | Intended user |
| --- | --- |
| `SUPER_ADMIN` | Platform operator outside a tenant. |
| `ADMIN` | Tenant owner/full workspace administrator. |
| `HR_ADMIN` | HR administrator with broad employee, leave, document, performance and notification access. |
| `HR_MANAGER` | HR operator/manager with employee, team, leave and performance access, but less tenant/security control. |
| `PAYROLL_ADMIN` | Payroll operator who can manage salary structures and payroll runs. |
| `RECRUITER` | Recruiting user who can manage jobs, pipeline and assessment integrations. |
| `HIRING_MANAGER` | Hiring owner/interviewer lead who can move candidates and issue offers. |
| `INTERVIEWER` | Interview participant who can read hiring records and submit feedback. |
| `MANAGER` | People manager for team leave, attendance, performance and hiring collaboration. |
| `EMPLOYEE` | Regular employee self-service user. |
| `AUDITOR` | Read-only audit/reporting user. |
| `FINANCE` | Finance user with payroll read access, not payroll execution. |
| `IT_ADMIN` | IT/security administrator for tenant settings, security policy and audit review. |

`SUPER_ADMIN` is platform-only. Tenant admins can assign tenant roles, but not
`SUPER_ADMIN`.

## Permission groups

| Area | Permission examples |
| --- | --- |
| Platform | `platform.manage` |
| Tenant/security | `tenant.settings.manage`, `tenant.billing.manage`, `security.manage`, `identity_providers.manage`, `audit.read` |
| Employees | `employees.read_full`, `employees.manage`, `employees.offboard`, `employees.roles.manage` |
| Attendance | `attendance.roster.read` |
| Leave | `leave.admin`, `leave.review` |
| Payroll | `payroll.read`, `payroll.salary.manage`, `payroll.run.manage`, `payroll.finalize` |
| Documents | `documents.team.read`, `documents.manage` |
| Performance | `performance.team.read`, `performance.manage`, `performance.review` |
| Hiring | `hiring.read`, `hiring.jobs.manage`, `hiring.pipeline.manage`, `hiring.offers.manage`, `hiring.assessments.manage`, `hiring.feedback.submit` |
| Notifications | `notifications.manage` |
| Analytics | `analytics.read` |

## Current built-in mapping

| Role | Main permissions |
| --- | --- |
| `SUPER_ADMIN` | Platform management only. |
| `ADMIN` | All tenant permissions, including `identity_providers.manage` (SSO/SCIM configuration), which no other role has. |
| `HR_ADMIN` | Tenant settings, analytics, employee management, role changes, attendance roster, leave admin/review, documents, performance, notifications. |
| `HR_MANAGER` | Analytics, employee read/manage, attendance roster, leave review, team documents, performance team/review. |
| `PAYROLL_ADMIN` | Analytics, employee full read, attendance roster, payroll read/salary/run/finalize. |
| `RECRUITER` | Analytics, hiring read/jobs/pipeline/assessments/feedback. |
| `HIRING_MANAGER` | Analytics, hiring read/pipeline/offers/feedback. |
| `INTERVIEWER` | Hiring read and feedback submission. |
| `MANAGER` | Analytics, attendance roster, leave review, team documents, team performance/review, hiring collaboration. |
| `EMPLOYEE` | Self-service access only. |
| `AUDITOR` | Audit read, analytics read, employee full read. |
| `FINANCE` | Analytics, employee full read, payroll read. |
| `IT_ADMIN` | Tenant settings, security management (auth policy, force logout, MFA reset), audit read. Not identity providers: an IdP decides who can sign in as whom, so configuring one would let `IT_ADMIN` sign in as an `ADMIN`. |

## Implementation rules

- Use `@Permissions(...)` on new APIs by default.
- Use `@Roles(...)` only for true role identity checks such as platform-only
  surfaces.
- Use service-level permission helpers when data visibility changes by scope.
- Keep frontend route/action visibility aligned with backend permissions.
- Changing a user's role revokes their sessions; the old access token stops
  working within seconds (session check), not after 15 minutes.
- Sensitive actions additionally use `@RequireStepUp()` (recent re-authentication
  on the same session): role changes, salary changes, payroll finalisation,
  auth-policy changes, identity-provider changes and SCIM token rotation, admin
  MFA reset, and GDPR erasure.
- IdP role mapping can assign any tenant role except `ADMIN`.

## Later upgrade path

The current system uses fixed built-in roles. If customers need custom roles
later, add a database-backed role model without changing feature code:

```text
User -> assigned role -> permissions -> guarded API action
```

That is why feature code should depend on permissions, not hard-coded job
titles.

# Roles and permissions

The portal uses built-in roles mapped to explicit permissions, plus workspace
custom roles built from the same permissions. Routes should
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

## Who can assign which role (no escalation)

Every role change — the Employees page, invitations, SSO group mapping and SCIM
groups — goes through `RoleAssignmentService`:

| Rule | Why |
| --- | --- |
| You can only grant a role whose permissions you hold yourself. | An HR_ADMIN cannot hand out payroll or security powers. |
| Only an `ADMIN` (built-in, not a custom role) can grant `ADMIN` or change an existing admin. | Previously an HR_ADMIN could promote anyone to ADMIN. |
| Invitations follow the same rules. | Otherwise anyone with `employees.manage` could invite an ADMIN account they control. |
| You cannot change your own role. | |
| The last active `ADMIN` cannot be demoted. | |
| Identity providers never grant `ADMIN` and never change an existing admin. | |

A change bumps the user's token version and revokes their sessions, and is audited as
`ROLE_CHANGED` (a person) or `ROLE_SYNCED_FROM_IDP` (an identity provider).

## Custom roles

Settings → **Custom roles** (permission `roles.manage`, ADMIN only; changes need step-up).

| Field | Meaning |
| --- | --- |
| Key | Permanent, `UPPER_SNAKE` (e.g. `REGIONAL_HR`). IdP mappings refer to it as `custom:REGIONAL_HR`. |
| Name / description | Shown in pickers. |
| Base role | Any built-in role except `ADMIN`. Decides pages and record scopes that depend on the role identity (e.g. a `MANAGER` base sees their direct reports). Stored as the user's `role`. |
| Permissions | The exact permission list; replaces the base role's permissions. |

- Not allowed in custom roles: `platform.manage`, `identity_providers.manage`,
  `roles.manage` (`NON_DELEGABLE_PERMISSIONS`). Full administration stays with `ADMIN`.
- Effective permissions are resolved on every request (cached 30 s per instance,
  cleared at once on the instance that edits the role). Editing permissions therefore
  applies within seconds without signing anyone out; changing the base role updates
  every holder and revokes their sessions.
- A deactivated (or missing) custom role grants **no** permissions — it does not fall
  back to the base role, because custom roles are usually narrower than their base.
- A role that is assigned to anyone cannot be deleted (409); deactivate it or reassign
  people first.
- Login, refresh and `GET /auth/me` return `customRoleId` and `permissions`; the web
  app hides actions accordingly (the API still enforces everything).

| Endpoint | Permission |
| --- | --- |
| `GET /roles` — permissions catalogue, built-in roles, custom roles with user counts | `roles.manage` or `employees.roles.manage` |
| `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id` | `roles.manage` + step-up |
| `PATCH /employees/:id/role` with `{ role }` or `{ customRoleId }` | `employees.roles.manage` + step-up |
| `POST /auth/invite` with `role` or `customRoleId` | `employees.manage` |

## Permission groups

| Area | Permission examples |
| --- | --- |
| Platform | `platform.manage` |
| Tenant/security | `tenant.settings.manage`, `tenant.billing.manage`, `security.manage`, `identity_providers.manage`, `roles.manage`, `audit.read` |
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
| `ADMIN` | All tenant permissions, including `identity_providers.manage` (SSO/SCIM configuration) and `roles.manage` (custom roles), which no other role has. |
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
  on the same session): role changes, custom-role edits, salary changes, payroll finalisation,
  auth-policy changes, identity-provider changes and SCIM token rotation, admin
  MFA reset, and GDPR erasure.
- IdP role mapping (SSO group claims and SCIM groups) can assign any tenant role
  except `ADMIN`, or a custom role as `custom:<KEY>`.
- Use `can(user, permission)` / `canAny(...)` in services, never role names: they read
  the user's effective permissions, so custom roles work everywhere.

## Design note

```text
User -> built-in role or custom role -> permissions -> guarded API action
```

Feature code depends on permissions, not job titles, which is what made custom roles
possible without touching feature modules.

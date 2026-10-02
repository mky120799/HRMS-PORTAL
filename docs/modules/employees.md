# Employees module

`apps/server/src/modules/employees`

## Purpose
The core HR record: directory, reporting lines, joining/exit, logins and roles.

## Data
`Employee`: `employeeCode` (unique per tenant), names, `email` (unique per tenant), `phone`,
`department`, `designation`, `managerId` (self-relation), `employmentType`, `status`
(`ACTIVE | ON_NOTICE | EXITED`), `dateOfJoining`, `exitDate`, `anonymizedAt`, optional `userId`.

## Endpoints

| Method & path | Access | Notes |
| --- | --- | --- |
| `GET /employees?search&department&status&page&pageSize` | user | Paginated. **Field-level visibility:** `employees.read_full` gets full records, everyone else directory fields only |
| `GET /employees/me` | user | Own full record |
| `GET /employees/:id` | user | Full record for self, `employees.read_full` users and the person's manager; directory fields otherwise |
| `POST /employees` | `employees.manage`, seat limit | Validates manager belongs to tenant |
| `PATCH /employees/:id` | `employees.manage` | Audited with before/after values; rejects reporting cycles |
| `POST /employees/:id/offboard` | `employees.offboard` | See below |
| `PATCH /employees/:id/role` | `employees.roles.manage` | Changes the linked user's role |

## Rules
* **Reporting cycles** (A→B→A) are rejected by walking up the manager chain.
* **Offboarding** (one transaction): status `EXITED` + exit date, direct reports move to the
  leaver's manager, pending leave is cancelled, the login is deactivated and every session
  revoked (`tokenVersion++`). Exited employees free a seat.
* **Role changes:** you cannot change your own role; the last active `ADMIN` cannot be demoted;
  the target's sessions are revoked so the new role applies at next sign-in.
* Exited employees are hidden from directory views without `employees.read_full` and cannot be edited.

## Tests
Security: cross-tenant read/update → 404, list isolation. Workflows: directory field
filtering, cycle rejection, self-role change blocked, offboarding revokes refresh and login.

## Interview talking points
* Why User and Employee are separate tables (not every employee logs in; operators aren't employees).
* Field-level authorisation via Prisma `select` sets instead of post-filtering objects.

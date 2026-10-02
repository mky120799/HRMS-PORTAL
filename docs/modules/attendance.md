# Attendance module

`apps/server/src/modules/attendance`

## Purpose
Self-service clock-in/out and daily rosters for managers and admins.
Attendance publishes `ATTENDANCE_HALF_DAY` and
`ATTENDANCE_MISSING_CLOCK_OUT` events through the central notification
platform. Employees receive in-app and email updates through the durable
notification outbox, subject to preferences, quiet hours, digest settings and
suppression rules.

## Data
`AttendanceRecord(tenantId, employeeId, date, clockIn, clockOut, workMinutes, status)` with a
unique `(employeeId, date)`. `date` is the calendar date **in the tenant's timezone**.

## Endpoints

| Method & path | Access | Notes |
| --- | --- | --- |
| `POST /attendance/clock-in` | user with employee profile | 409 if already clocked in today |
| `POST /attendance/clock-out` | same | computes `workMinutes`; < 4 h → `HALF_DAY` |
| `GET /attendance/me?from&to` | same | `{ today, records }`, default last 30 days, max 1 year |
| `GET /attendance/roster?date` | MANAGER (direct reports), ADMIN (everyone) | present / half-day / absent per employee + summary |

## Rules
* **"Today" is tenant-local.** `todayIn(tenant.timezone)` — an employee in India clocking in at
  00:30 IST is recorded on the correct day even though servers run in UTC.
* **Double clock-in is impossible even under concurrency**: the unique index rejects the second
  insert; the Prisma P2002 error is translated to 409 (no check-then-insert race).
* **Missing clock-out reminders are idempotent.** The scheduler uses the
  attendance record id as the notification event key, so repeated scheduler
  runs do not create duplicate logical reminders.
* The employee is always the caller (`user.employeeId` from the token). The original code used
  an undefined id, which matched *the first employee in the tenant* — everyone clocked in as the
  same person.

## Tests
Workflows: clock-in/duplicate/clock-out, record belongs to the caller, manager roster scope.
Unit: `todayIn` across timezones.

## Next steps
Geo-fencing or IP-based office check-in, regularisation requests, shift schedules.

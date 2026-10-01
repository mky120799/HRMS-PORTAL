# Analytics module

`apps/server/src/modules/analytics` — `GET /analytics/overview` (ADMIN, MANAGER · plan BUSINESS)

## Current coverage

Returns, in a single parallel batch of aggregate queries:

| Field | Description |
|---|---|
| `summary.totalEmployees` | Active (non-EXITED) headcount |
| `summary.pendingLeaves` | Leave requests awaiting approval |
| `summary.openJobs` | Jobs with status OPEN |
| `summary.totalApplications` | All-time application count |
| `summary.hiredCount` | Applications in HIRED status |
| `summary.presentToday` | Attendance records for tenant-timezone "today" |
| `summary.attendanceRateToday` | `presentToday / totalEmployees * 100` |
| `summary.attritionRate12m` | `exits / avgHeadcount * 100` (rolling 12 months) |
| `departmentBreakdown` | Headcount by department (pie chart data) |
| `monthlyLeave` | Monthly leave requests by status for last 6 months |
| `hiringFunnel` | Application count per stage (Applied → Hired) |

## Implementation notes

* Only aggregate queries (`count`, `groupBy`, one grouped raw SQL with `date_trunc`) run in
  parallel — cost stays flat as data grows; no table is loaded into memory.
* The raw SQL uses Prisma's tagged template so values are parameterised (no injection risk).
* `today` is resolved to the tenant's configured timezone before comparing with date-only fields.

## Known gaps / roadmap

The following hiring-specific metrics are **not yet implemented** (tracked in
[`HIRING_ROADMAP.md`](HIRING_ROADMAP.md#h2)):

| Metric | Missing because |
|---|---|
| Source of hire | No `source` field on `Application` yet |
| Time-to-hire (avg / median days) | No aggregation query; needs stage-event timestamps |
| Time per stage | Needs median of `ApplicationEvent` timestamp deltas per stage |
| Offer acceptance rate | `OFFERED → HIRED` conversion not computed |

A dedicated `GET /analytics/hiring` endpoint is planned once the `source` field and
stage-event timestamp queries are added.

## Future notes

* Cache per tenant for a few minutes, or pre-aggregate nightly, if dashboards get heavy.
* Consider PostgreSQL `MATERIALIZED VIEW` refreshed every 5 minutes for the funnel query.

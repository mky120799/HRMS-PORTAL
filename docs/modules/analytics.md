# Analytics module

`apps/server/src/modules/analytics` — `GET /analytics/overview` (`analytics.read` · plan BUSINESS)

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

## Recruitment analytics

`GET /analytics/hiring` returns source of hire, average/median time to hire, median duration
per custom stage, and offer acceptance. Durations use actual stage-entry events beginning at
`APPLICATION_SUBMITTED`; legacy rows without trustworthy history remain in counts but are
excluded from duration metrics. Offer acceptance uses the historical offered cohort rather
than current status, so later rejection does not erase an offer.

## Future notes

* Cache per tenant for a few minutes, or pre-aggregate nightly, if dashboards get heavy.
* Consider PostgreSQL `MATERIALIZED VIEW` refreshed every 5 minutes for the funnel query.

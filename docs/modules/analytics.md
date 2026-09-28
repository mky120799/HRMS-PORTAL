# Analytics module

`apps/server/src/modules/analytics` — `GET /analytics/overview` (ADMIN, MANAGER · plan BUSINESS)

Returns headcount, pending leave, open jobs, applications/hires, present-today and attendance
rate (tenant-timezone "today"), **12-month attrition rate** (exits ÷ average headcount),
department breakdown, monthly leave trend for 6 months, and the hiring funnel by stage.

Implementation notes:
* Only aggregate queries (`count`, `groupBy`, one grouped raw SQL with `date_trunc`) run in
  parallel — cost stays flat as data grows; no table is loaded into memory.
* The raw SQL uses Prisma's tagged template, so values are parameterised (no injection).
* Next step: cache per tenant for a few minutes, or pre-aggregate nightly, if dashboards get heavy.

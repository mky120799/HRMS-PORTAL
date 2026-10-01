import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { todayIn, parseDateOnly } from '../../common/utils/dates';

/**
 * Workspace KPIs for the dashboard. All queries are aggregate (count/groupBy)
 * so cost stays flat as tenants grow; nothing loads full tables into memory.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(tenantId: string, timezone: string) {
    const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 5, 1));
    const yearAgo = new Date(Date.now() - 365 * 86_400_000);
    const today = parseDateOnly(todayIn(timezone));

    const [activeEmployees, exitedLastYear, pendingLeaves, openJobs, byDepartment, funnel, presentToday, leaveRows] = await Promise.all([
      this.prisma.employee.count({ where: { tenantId, status: { not: 'EXITED' } } }),
      this.prisma.employee.count({ where: { tenantId, status: 'EXITED', exitDate: { gte: yearAgo } } }),
      this.prisma.leaveRequest.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.job.count({ where: { tenantId, status: 'OPEN' } }),
      this.prisma.employee.groupBy({ by: ['department'], where: { tenantId, status: { not: 'EXITED' } }, _count: { _all: true } }),
      this.prisma.application.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.attendanceRecord.count({ where: { tenantId, date: today } }),
      this.prisma.$queryRaw<{ month: string; status: string; count: bigint }[]>`
        SELECT to_char(date_trunc('month', "startDate"), 'YYYY-MM') AS month, status, COUNT(*)::bigint AS count
        FROM "LeaveRequest"
        WHERE "tenantId" = ${tenantId} AND "startDate" >= ${since}
        GROUP BY 1, 2 ORDER BY 1`,
    ]);

    const funnelCount = (s: string) => funnel.find((f) => f.status === s)?._count._all ?? 0;
    const totalApplications = funnel.reduce((sum, f) => sum + f._count._all, 0);
    const months = new Map<string, { month: string; approved: number; pending: number; rejected: number }>();
    for (const r of leaveRows) {
      const m = months.get(r.month) ?? { month: r.month, approved: 0, pending: 0, rejected: 0 };
      const c = Number(r.count);
      if (r.status === 'APPROVED') m.approved += c;
      else if (r.status === 'PENDING') m.pending += c;
      else if (r.status === 'REJECTED') m.rejected += c;
      months.set(r.month, m);
    }
    const avgHeadcount = activeEmployees + exitedLastYear / 2;

    return {
      summary: {
        totalEmployees: activeEmployees,
        pendingLeaves,
        openJobs,
        totalApplications,
        hiredCount: funnelCount('HIRED'),
        presentToday,
        attendanceRateToday: activeEmployees ? Math.round((presentToday / activeEmployees) * 100) : 0,
        attritionRate12m: avgHeadcount ? Math.round((exitedLastYear / avgHeadcount) * 1000) / 10 : 0,
      },
      departmentBreakdown: byDepartment.map((d) => ({ department: d.department ?? 'Unassigned', count: d._count._all })),
      monthlyLeave: [...months.values()],
      hiringFunnel: [
        { stage: 'Applied', count: totalApplications },
        { stage: 'Screening', count: funnelCount('SCREENING') },
        { stage: 'Interview', count: funnelCount('INTERVIEW') },
        { stage: 'Offered', count: funnelCount('OFFERED') },
        { stage: 'Hired', count: funnelCount('HIRED') },
      ],
    };
  }

  /**
   * Recruitment-specific KPIs: source of hire, time-to-hire, time-per-stage,
   * and offer acceptance rate.
   *
   * Time calculations are derived from ApplicationEvent timestamps to avoid
   * storing redundant date columns while remaining accurate across stage moves.
   */
  async hiringMetrics(tenantId: string) {
    const [sourceRows, timeToHireRows, timePerStageRows, offerRows] = await Promise.all([
      // Source of hire — count by source for all applications, and for hired ones
      this.prisma.$queryRaw<{ source: string; total: bigint; hired: bigint }[]>`
        SELECT source,
               COUNT(*)::bigint                                          AS total,
               COUNT(*) FILTER (WHERE status = 'HIRED')::bigint         AS hired
        FROM "Application"
        WHERE "tenantId" = ${tenantId}
        GROUP BY source
        ORDER BY hired DESC`,

      // Time to hire — avg and median days from application createdAt to HIRED event
      this.prisma.$queryRaw<{ avg_days: number | null; median_days: number | null }[]>`
        SELECT
          ROUND(AVG(EXTRACT(EPOCH FROM (e."createdAt" - a."createdAt")) / 86400)::numeric, 1) AS avg_days,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (e."createdAt" - a."createdAt")) / 86400
          ) AS median_days
        FROM "Application" a
        JOIN "ApplicationEvent" e
          ON e."applicationId" = a.id
          AND e."tenantId" = ${tenantId}
          AND e.type = 'STAGE_CHANGED'
          AND e.metadata->>'toStatus' = 'HIRED'
        WHERE a."tenantId" = ${tenantId}
          AND a.status = 'HIRED'`,

      // Median days spent in each stage — time between consecutive STAGE_CHANGED events
      this.prisma.$queryRaw<{ stage: string; median_days: number }[]>`
        WITH ordered AS (
          SELECT
            "applicationId",
            metadata->>'fromStatus'                                       AS stage,
            EXTRACT(EPOCH FROM
              LEAD("createdAt") OVER (PARTITION BY "applicationId" ORDER BY "createdAt")
              - "createdAt"
            ) / 86400                                                     AS days_in_stage
          FROM "ApplicationEvent"
          WHERE "tenantId" = ${tenantId}
            AND type = 'STAGE_CHANGED'
        )
        SELECT
          stage,
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_in_stage)::numeric, 1) AS median_days
        FROM ordered
        WHERE stage IS NOT NULL AND days_in_stage IS NOT NULL
        GROUP BY stage
        ORDER BY MIN(CASE stage
          WHEN 'APPLIED'    THEN 1
          WHEN 'SCREENING'  THEN 2
          WHEN 'INTERVIEW'  THEN 3
          WHEN 'OFFERED'    THEN 4
          ELSE 99 END)`,

      // Offer acceptance rate
      this.prisma.application.groupBy({
        by: ['status'],
        where: { tenantId, status: { in: ['OFFERED', 'HIRED'] } },
        _count: { _all: true },
      }),
    ]);

    const offeredCount = offerRows.find((r) => r.status === 'OFFERED')?._count._all ?? 0;
    const hiredFromOffer = offerRows.find((r) => r.status === 'HIRED')?._count._all ?? 0;
    const totalOffered = offeredCount + hiredFromOffer;

    return {
      sourceOfHire: sourceRows.map((r) => ({
        source: r.source,
        applied: Number(r.total),
        hired: Number(r.hired),
      })),
      timeToHire: {
        avgDays: timeToHireRows[0]?.avg_days ?? null,
        medianDays: timeToHireRows[0]?.median_days ? Math.round(Number(timeToHireRows[0].median_days) * 10) / 10 : null,
      },
      timePerStage: timePerStageRows.map((r) => ({
        stage: r.stage,
        medianDays: Number(r.median_days),
      })),
      offerAcceptanceRate: totalOffered > 0 ? Math.round((hiredFromOffer / totalOffered) * 1000) / 10 : null,
    };
  }
}

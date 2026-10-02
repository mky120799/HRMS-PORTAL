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
        WITH hired_at AS (
          SELECT "applicationId", MIN("createdAt") AS "createdAt"
          FROM "ApplicationEvent"
          WHERE "tenantId" = ${tenantId}
            AND type IN ('STAGE_CHANGED', 'STAGE_ROLLED_BACK')
            AND metadata->>'toStatus' = 'HIRED'
          GROUP BY "applicationId"
        )
        SELECT
          ROUND(AVG(EXTRACT(EPOCH FROM (e."createdAt" - a."createdAt")) / 86400)::numeric, 1) AS avg_days,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (e."createdAt" - a."createdAt")) / 86400
          ) AS median_days
        FROM "Application" a
        JOIN hired_at e ON e."applicationId" = a.id
        WHERE a."tenantId" = ${tenantId}`,

      // Stage-entry events give the entered stage and the next entry closes its duration.
      // Requiring APPLICATION_SUBMITTED deliberately excludes legacy backfilled rows that
      // have no trustworthy historical timestamps.
      this.prisma.$queryRaw<{ stage: string; median_days: number }[]>`
        WITH eligible AS (
          SELECT DISTINCT "applicationId"
          FROM "ApplicationEvent"
          WHERE "tenantId" = ${tenantId} AND type = 'APPLICATION_SUBMITTED'
        ), entries AS (
          SELECT e."applicationId", e."createdAt", e.id,
                 e.metadata->>'stageId' AS stage_id,
                 e.metadata->>'stageName' AS stage
          FROM "ApplicationEvent" e
          JOIN eligible ok ON ok."applicationId" = e."applicationId"
          WHERE e."tenantId" = ${tenantId} AND e.type = 'APPLICATION_SUBMITTED'
          UNION ALL
          SELECT e."applicationId", e."createdAt", e.id,
                 e.metadata->>'toStageId' AS stage_id,
                 e.metadata->>'toStageName' AS stage
          FROM "ApplicationEvent" e
          JOIN eligible ok ON ok."applicationId" = e."applicationId"
          WHERE e."tenantId" = ${tenantId}
            AND e.type IN ('STAGE_CHANGED', 'STAGE_ROLLED_BACK')
        ), ordered AS (
          SELECT
            "applicationId",
            stage_id,
            stage,
            EXTRACT(EPOCH FROM
              LEAD("createdAt") OVER (PARTITION BY "applicationId" ORDER BY "createdAt", id)
              - "createdAt"
            ) / 86400                                                     AS days_in_stage
          FROM entries
        )
        SELECT
          o.stage,
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY o.days_in_stage)::numeric, 1) AS median_days
        FROM ordered o
        LEFT JOIN "HiringStage" s ON s.id = o.stage_id AND s."tenantId" = ${tenantId}
        WHERE o.stage IS NOT NULL AND o.days_in_stage IS NOT NULL
        GROUP BY o.stage
        ORDER BY MIN(s.position) NULLS LAST, o.stage`,

      // Offer acceptance is cohort based: later rejection does not erase the offer.
      this.prisma.$queryRaw<{ total_offered: bigint; hired_from_offer: bigint }[]>`
        WITH offered AS (
          SELECT "applicationId", MIN("createdAt") AS offered_at
          FROM "ApplicationEvent"
          WHERE "tenantId" = ${tenantId}
            AND type IN ('STAGE_CHANGED', 'STAGE_ROLLED_BACK')
            AND metadata->>'toStatus' = 'OFFERED'
          GROUP BY "applicationId"
        ), hired AS (
          SELECT DISTINCT o."applicationId"
          FROM offered o
          JOIN "ApplicationEvent" e ON e."applicationId" = o."applicationId"
            AND e."tenantId" = ${tenantId}
            AND e.type IN ('STAGE_CHANGED', 'STAGE_ROLLED_BACK')
            AND e.metadata->>'toStatus' = 'HIRED'
            AND e."createdAt" >= o.offered_at
        )
        SELECT COUNT(*)::bigint AS total_offered,
               COUNT(h."applicationId")::bigint AS hired_from_offer
        FROM offered o
        LEFT JOIN hired h ON h."applicationId" = o."applicationId"`,
    ]);

    const totalOffered = Number(offerRows[0]?.total_offered ?? 0);
    const hiredFromOffer = Number(offerRows[0]?.hired_from_offer ?? 0);

    return {
      sourceOfHire: sourceRows.map((r) => ({
        source: r.source,
        applied: Number(r.total),
        hired: Number(r.hired),
      })),
      timeToHire: {
        avgDays:
          timeToHireRows[0]?.avg_days == null
            ? null
            : Number(timeToHireRows[0].avg_days),
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

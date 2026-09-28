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
}

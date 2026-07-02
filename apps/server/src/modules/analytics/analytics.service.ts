import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getOverview(tenantId: string) {
    const [
      totalEmployees,
      totalLeaveRequests,
      pendingLeaves,
      openJobs,
      totalApplications,
      hiredCount,
      employees,
      leavesByMonth,
    ] = await Promise.all([
      this.prisma.employee.count({ where: { tenantId } }),
      this.prisma.leaveRequest.count({ where: { tenantId } }),
      this.prisma.leaveRequest.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.job.count({ where: { tenantId, status: 'OPEN' } }),
      this.prisma.application.count({ where: { job: { tenantId } } }),
      this.prisma.application.count({ where: { job: { tenantId }, status: 'HIRED' } }),
      // Department breakdown
      this.prisma.employee.groupBy({
        by: ['department'],
        where: { tenantId },
        _count: { id: true },
      }),
      // Monthly leave data for the last 6 months
      this.prisma.leaveRequest.findMany({
        where: {
          tenantId,
          createdAt: {
            gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
          },
        },
        select: { createdAt: true, status: true, type: true },
      }),
    ]);

    // Process department breakdown
    const departmentBreakdown = employees.map((e) => ({
      department: e.department ?? 'Unassigned',
      count: e._count.id,
    }));

    // Process monthly leave trend
    const monthlyLeave = this.buildMonthlyLeave(leavesByMonth);

    // Hiring funnel
    const hiringFunnel = [
      { stage: 'Applied', count: totalApplications },
      { stage: 'Interviewed', count: await this.prisma.application.count({ where: { job: { tenantId }, status: 'INTERVIEW' } }) },
      { stage: 'Hired', count: hiredCount },
    ];

    return {
      summary: {
        totalEmployees,
        totalLeaveRequests,
        pendingLeaves,
        openJobs,
        totalApplications,
        hiredCount,
      },
      departmentBreakdown,
      monthlyLeave,
      hiringFunnel,
    };
  }

  private buildMonthlyLeave(leaves: { createdAt: Date; status: string; type: string }[]) {
    const months: Record<string, { month: string; approved: number; pending: number; rejected: number }> = {};

    leaves.forEach((leave) => {
      const key = leave.createdAt.toISOString().slice(0, 7); // "YYYY-MM"
      const label = new Date(leave.createdAt).toLocaleString('default', { month: 'short', year: '2-digit' });
      if (!months[key]) months[key] = { month: label, approved: 0, pending: 0, rejected: 0 };
      if (leave.status === 'APPROVED') months[key].approved++;
      else if (leave.status === 'PENDING') months[key].pending++;
      else if (leave.status === 'REJECTED') months[key].rejected++;
    });

    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }
}

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { can } from '../../common/auth/permissions';

const PEOPLE = { select: { id: true, firstName: true, lastName: true, department: true, designation: true } } as const;

/**
 * Review cycle state machine (per employee, per cycle):
 *   DRAFT ──(employee self-review)──▶ SELF_SUBMITTED ──(manager review)──▶ COMPLETED
 * The reviewer is the employee's manager at the time the cycle is opened.
 */
@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  mine(user: AuthUser) {
    if (!user.employeeId) return [];
    return this.prisma.performanceReview.findMany({
      where: { tenantId: user.tenantId, employeeId: user.employeeId },
      include: { reviewer: PEOPLE },
      orderBy: { createdAt: 'desc' },
    });
  }

  team(user: AuthUser) {
    if (!user.employeeId) return [];
    return this.prisma.performanceReview.findMany({
      where: { tenantId: user.tenantId, reviewerId: user.employeeId },
      include: { employee: PEOPLE },
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
    });
  }

  all(tenantId: string, cycleName?: string) {
    return this.prisma.performanceReview.findMany({
      where: { tenantId, ...(cycleName ? { cycleName } : {}) },
      include: { employee: PEOPLE, reviewer: PEOPLE },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
  }

  async cycles(tenantId: string) {
    const rows = await this.prisma.performanceReview.groupBy({ by: ['cycleName', 'status'], where: { tenantId }, _count: { _all: true } });
    const byCycle = new Map<string, { cycleName: string; draft: number; selfSubmitted: number; completed: number; total: number }>();
    for (const r of rows) {
      const c = byCycle.get(r.cycleName) ?? { cycleName: r.cycleName, draft: 0, selfSubmitted: 0, completed: 0, total: 0 };
      if (r.status === 'DRAFT') c.draft += r._count._all;
      if (r.status === 'SELF_SUBMITTED') c.selfSubmitted += r._count._all;
      if (r.status === 'COMPLETED') c.completed += r._count._all;
      c.total += r._count._all;
      byCycle.set(r.cycleName, c);
    }
    return [...byCycle.values()];
  }

  /** Opens a cycle for every active employee. Idempotent: re-running only adds people who joined since. */
  async openCycle(tenantId: string, cycleName: string) {
    const employees = await this.prisma.employee.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, managerId: true } });
    const { count } = await this.prisma.performanceReview.createMany({
      data: employees.map((e) => ({ tenantId, employeeId: e.id, reviewerId: e.managerId, cycleName, status: 'DRAFT' })),
      skipDuplicates: true,
    });
    const withoutManager = employees.filter((e) => !e.managerId).length;
    return { cycleName, created: count, employeesWithoutManager: withoutManager };
  }

  async submitSelf(user: AuthUser, id: string, rating: number, comments: string) {
    const review = await this.prisma.performanceReview.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!review) throw new NotFoundException('Review not found');
    if (review.employeeId !== user.employeeId) throw new ForbiddenException('You can only submit your own self-review');
    if (review.status !== 'DRAFT') throw new ConflictException('Self-review has already been submitted');
    return this.prisma.performanceReview.update({
      where: { id },
      data: { selfRating: rating, selfComments: comments, status: 'SELF_SUBMITTED', submittedAt: new Date() },
    });
  }

  async submitManager(user: AuthUser, id: string, rating: number, comments: string) {
    const review = await this.prisma.performanceReview.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!review) throw new NotFoundException('Review not found');
    if (review.employeeId === user.employeeId) throw new ForbiddenException('You cannot review yourself');
    const isReviewer = !!user.employeeId && review.reviewerId === user.employeeId;
    if (!isReviewer && !can(user, 'performance.manage')) throw new ForbiddenException('Only the assigned reviewer or a performance admin can complete this review');
    if (review.status !== 'SELF_SUBMITTED') throw new ConflictException('The employee must submit their self-review first');
    return this.prisma.performanceReview.update({
      where: { id },
      data: {
        managerRating: rating,
        managerComments: comments,
        reviewerId: review.reviewerId ?? user.employeeId,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  }
}

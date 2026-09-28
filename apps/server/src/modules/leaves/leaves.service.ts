import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EmailService } from '../../common/email/email.service';
import { EmailTemplates } from '../../common/email/templates';
import { SlackService } from '../integrations/slack.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginate, paged } from '../../common/validation/common.schemas';
import { countWorkingDays, parseDateOnly, toDateOnly } from '../../common/utils/dates';
import type { CreateLeaveRequestDto, ListLeavesQuery, ReviewLeaveDto } from './dto/create-leave.dto';

const COUNTED = ['PENDING', 'APPROVED'];

@Injectable()
export class LeavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly slack: SlackService,
  ) {}

  // ─── Queries ────────────────────────────────────────────────────────────────

  /**
   * Visibility: employees see their own requests; managers additionally see
   * their direct reports' (scope=team); admins see everything (scope=all).
   */
  async list(user: AuthUser, q: ListLeavesQuery) {
    let scope: Prisma.LeaveRequestWhereInput;
    if (q.scope === 'all') {
      if (user.role !== 'ADMIN') throw new ForbiddenException('Only admins can view all leave requests');
      scope = {};
    } else if (q.scope === 'team') {
      if (!user.employeeId || (user.role !== 'MANAGER' && user.role !== 'ADMIN')) throw new ForbiddenException('Only managers can view team leave');
      scope = { employee: { managerId: user.employeeId } };
    } else {
      if (!user.employeeId) return paged([], 0, q);
      scope = { employeeId: user.employeeId };
    }
    const where: Prisma.LeaveRequestWhereInput = { tenantId: user.tenantId, ...scope, ...(q.status ? { status: q.status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return paged(items, total, q);
  }

  /** Per-type balance for a calendar year: quota, approved (used), pending, remaining. */
  async balance(user: AuthUser, employeeId: string | undefined, year: number) {
    const targetId = employeeId ?? user.employeeId;
    if (!targetId) throw new NotFoundException('Your account is not linked to an employee profile');
    await this.assertCanActFor(user, targetId, 'view');

    const [policies, grouped] = await Promise.all([
      this.prisma.leavePolicy.findMany({ where: { tenantId: user.tenantId }, orderBy: { type: 'asc' } }),
      this.prisma.leaveRequest.groupBy({
        by: ['type', 'status'],
        where: { tenantId: user.tenantId, employeeId: targetId, status: { in: COUNTED }, startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
        _sum: { days: true },
      }),
    ]);
    const sum = (type: string, status: string) => grouped.find((g) => g.type === type && g.status === status)?._sum.days ?? 0;
    return policies.map((p) => {
      const used = sum(p.type, 'APPROVED');
      const pending = sum(p.type, 'PENDING');
      return { type: p.type, isPaid: p.isPaid, quota: p.isPaid ? p.annualQuota : null, used, pending, remaining: p.isPaid ? p.annualQuota - used - pending : null };
    });
  }

  // ─── Commands ───────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateLeaveRequestDto) {
    const employeeId = dto.employeeId ?? user.employeeId;
    if (!employeeId) throw new BadRequestException('Your account is not linked to an employee profile');
    if (dto.employeeId && dto.employeeId !== user.employeeId && user.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can request leave on behalf of someone else');
    }

    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId: user.tenantId } });
    if (!employee || employee.status === 'EXITED') throw new NotFoundException('Employee not found');

    const policy = await this.prisma.leavePolicy.findUnique({ where: { tenantId_type: { tenantId: user.tenantId, type: dto.type } } });
    if (!policy) throw new BadRequestException(`Unknown leave type ${dto.type}`);

    const start = parseDateOnly(dto.startDate);
    const end = parseDateOnly(dto.endDate);
    if (start.getUTCFullYear() !== end.getUTCFullYear()) throw new BadRequestException('Split leave that crosses a year boundary into two requests');
    const horizon = Date.now() + 366 * 86_400_000;
    if (end.getTime() > horizon) throw new BadRequestException('Leave can be requested at most one year ahead');

    const days = await this.workingDays(user.tenantId, start, end);
    if (days === 0) throw new BadRequestException('The selected range has no working days');

    const overlapping = await this.prisma.leaveRequest.count({
      where: { tenantId: user.tenantId, employeeId, status: { in: COUNTED }, startDate: { lte: end }, endDate: { gte: start } },
    });
    if (overlapping) throw new ConflictException('This overlaps an existing pending or approved leave request');

    if (policy.isPaid) await this.assertBalance(user.tenantId, employeeId, policy.type, policy.annualQuota, start.getUTCFullYear(), days);

    return this.prisma.leaveRequest.create({
      data: { tenantId: user.tenantId, employeeId, type: policy.type, startDate: start, endDate: end, days, reason: dto.reason, status: 'PENDING' },
    });
  }

  /**
   * Approve / reject. Allowed for admins and the employee's direct manager —
   * never for your own request. The status change is a conditional update
   * (WHERE status = 'PENDING'), so two approvers clicking at once cannot both win.
   */
  async review(user: AuthUser, id: string, dto: ReviewLeaveDto) {
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { employee: { select: { id: true, firstName: true, lastName: true, email: true, managerId: true, userId: true } } },
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.employeeId === user.employeeId) throw new ForbiddenException('You cannot approve your own leave');
    const isManager = !!user.employeeId && leave.employee.managerId === user.employeeId;
    if (user.role !== 'ADMIN' && !isManager) throw new ForbiddenException('Only the employee’s manager or an admin can review this request');
    if (leave.status !== 'PENDING') throw new ConflictException(`This request is already ${leave.status.toLowerCase()}`);

    const result = await this.prisma.leaveRequest.updateMany({
      where: { id, tenantId: user.tenantId, status: 'PENDING' },
      data: { status: dto.status, reviewedById: user.userId, reviewedAt: new Date(), reviewNote: dto.note },
    });
    if (result.count === 0) throw new ConflictException('This request was already reviewed');

    const employeeName = `${leave.employee.firstName} ${leave.employee.lastName}`.trim();
    const [from, to] = [toDateOnly(leave.startDate), toDateOnly(leave.endDate)];
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: `LEAVE_${dto.status}`, resource: 'leave-requests', resourceId: id, oldValues: { status: 'PENDING' }, newValues: { status: dto.status, note: dto.note } });
    await this.email.send({
      tenantId: user.tenantId,
      to: leave.employee.email,
      recipientUserId: leave.employee.userId,
      email: EmailTemplates.leaveDecision({ name: leave.employee.firstName, status: dto.status, type: leave.type, from, to, note: dto.note }),
    });
    void this.slack.leaveDecision(user.tenantId, { employeeName, type: leave.type, from, to, days: leave.days, status: dto.status, approvedBy: user.name || user.email });

    return this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
  }

  /** Employees cancel their own pending requests; admins may also cancel approved leave that has not started. */
  async cancel(user: AuthUser, id: string) {
    const leave = await this.prisma.leaveRequest.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!leave) throw new NotFoundException('Leave request not found');
    const own = leave.employeeId === user.employeeId;
    const cancellable = leave.status === 'PENDING' || (leave.status === 'APPROVED' && user.role === 'ADMIN' && leave.startDate > new Date());
    if ((!own && user.role !== 'ADMIN') || !cancellable) throw new ForbiddenException('This request can no longer be cancelled');
    return this.prisma.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  // ─── Policies & holidays ────────────────────────────────────────────────────

  listPolicies(tenantId: string) {
    return this.prisma.leavePolicy.findMany({ where: { tenantId }, orderBy: { type: 'asc' } });
  }

  upsertPolicy(tenantId: string, dto: { type: string; annualQuota: number; isPaid: boolean }) {
    return this.prisma.leavePolicy.upsert({
      where: { tenantId_type: { tenantId, type: dto.type } },
      update: { annualQuota: dto.annualQuota, isPaid: dto.isPaid },
      create: { tenantId, ...dto },
    });
  }

  listHolidays(tenantId: string, year: number) {
    return this.prisma.holiday.findMany({
      where: { tenantId, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      orderBy: { date: 'asc' },
    });
  }

  addHoliday(tenantId: string, dto: { date: string; name: string }) {
    return this.prisma.holiday.create({ data: { tenantId, date: parseDateOnly(dto.date), name: dto.name } });
  }

  async removeHoliday(tenantId: string, id: string) {
    const { count } = await this.prisma.holiday.deleteMany({ where: { id, tenantId } });
    if (!count) throw new NotFoundException('Holiday not found');
    return { deleted: true };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async workingDays(tenantId: string, start: Date, end: Date): Promise<number> {
    const holidays = await this.prisma.holiday.findMany({ where: { tenantId, date: { gte: start, lte: end } }, select: { date: true } });
    return countWorkingDays(start, end, new Set(holidays.map((h) => toDateOnly(h.date))));
  }

  private async assertBalance(tenantId: string, employeeId: string, type: string, quota: number, year: number, requested: number) {
    const agg = await this.prisma.leaveRequest.aggregate({
      where: { tenantId, employeeId, type, status: { in: COUNTED }, startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      _sum: { days: true },
    });
    const committed = agg._sum.days ?? 0;
    if (committed + requested > quota) {
      throw new BadRequestException(`Insufficient ${type} balance: ${Math.max(quota - committed, 0)} day(s) left, ${requested} requested`);
    }
  }

  private async assertCanActFor(user: AuthUser, employeeId: string, _action: 'view') {
    if (employeeId === user.employeeId || user.role === 'ADMIN') return;
    const isReport = user.employeeId
      ? await this.prisma.employee.count({ where: { id: employeeId, tenantId: user.tenantId, managerId: user.employeeId } })
      : 0;
    if (!isReport) throw new ForbiddenException('You can only view your own or your team’s balances');
  }
}

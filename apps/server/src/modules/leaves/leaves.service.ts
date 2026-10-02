import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { can } from '../../common/auth/permissions';
import { PrismaService } from '../../common/prisma/prisma.service';
import { paginate, paged } from '../../common/validation/common.schemas';
import { todayIn } from '../../common/utils/dates';
import type { AdjustLeaveBalanceDto, ApprovalDelegationDto, CreateLeaveRequestDto, LeaveLedgerQuery, ListLeavesQuery, ReplaceApprovalRulesDto, ReviewLeaveDto } from './dto/create-leave.dto';
import { LeaveAccrualService } from './leave-accrual.service';
import { LeaveApprovalService } from './leave-approval.service';
import { LeaveCalendarService } from './leave-calendar.service';
import { LeaveLedgerService } from './leave-ledger.service';
import { LeavePolicyInput, LeavePolicyService } from './leave-policy.service';
import { LeaveRequestService } from './leave-request.service';
import { LeaveTransactionService } from './leave-transaction.service';

const COUNTED = ['PENDING', 'APPROVED'];
export { LEAVE_PROCESSING_QUEUE } from '../../common/messaging/rabbitmq.service';

/** Public API façade; focused services own each leave domain concern. */
@Injectable()
export class LeavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly requests: LeaveRequestService,
    private readonly calendar: LeaveCalendarService,
    private readonly accruals: LeaveAccrualService,
    private readonly approvals: LeaveApprovalService,
    private readonly ledgerService: LeaveLedgerService,
    private readonly policies: LeavePolicyService,
    private readonly transactions: LeaveTransactionService,
  ) {}

  async list(user: AuthUser, query: ListLeavesQuery) {
    let scope: Prisma.LeaveRequestWhereInput;
    if (query.scope === 'all') {
      if (!can(user, 'leave.admin')) throw new ForbiddenException('Only leave admins can view all leave requests');
      scope = {};
    } else if (query.scope === 'team') {
      if (!user.employeeId || !can(user, 'leave.review')) throw new ForbiddenException('Only leave reviewers can view team leave');
      scope = { employee: { managerId: user.employeeId } };
    } else {
      if (!user.employeeId) return paged([], 0, query);
      scope = { employeeId: user.employeeId };
    }
    const where: Prisma.LeaveRequestWhereInput = { tenantId: user.tenantId, ...scope, ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } }, orderBy: { createdAt: 'desc' }, ...paginate(query) }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return paged(items, total, query);
  }

  async balance(user: AuthUser, employeeId: string | undefined, year: number) {
    const targetId = employeeId ?? user.employeeId;
    if (!targetId) throw new NotFoundException('Your account is not linked to an employee profile');
    await this.assertCanActFor(user, targetId);
    const [policies, grouped] = await Promise.all([
      this.prisma.leavePolicy.findMany({ where: { tenantId: user.tenantId }, orderBy: { type: 'asc' } }),
      this.prisma.leaveRequest.groupBy({ by: ['type', 'status'], where: { tenantId: user.tenantId, employeeId: targetId, status: { in: COUNTED }, startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, _sum: { days: true } }),
    ]);
    const sum = (type: string, status: string) => grouped.find((entry) => entry.type === type && entry.status === status)?._sum.days ?? 0;
    return Promise.all(policies.map(async (policy) => {
      const used = sum(policy.type, 'APPROVED');
      const pending = sum(policy.type, 'PENDING');
      const ledger = policy.isPaid ? await this.prisma.leaveBalanceLedger.aggregate({ where: { tenantId: user.tenantId, employeeId: targetId, type: policy.type, year }, _sum: { days: true } }) : null;
      const ledgerRemaining = ledger?._sum.days == null ? null : Number(ledger._sum.days);
      return { type: policy.type, isPaid: policy.isPaid, quota: policy.isPaid ? policy.annualQuota : null, used, pending, remaining: policy.isPaid ? (ledgerRemaining ?? policy.annualQuota - used - pending) : null };
    }));
  }

  async ledger(user: AuthUser, query: LeaveLedgerQuery) {
    const employeeId = query.employeeId ?? user.employeeId;
    if (!employeeId) throw new NotFoundException('Your account is not linked to an employee profile');
    await this.assertCanActFor(user, employeeId);
    return this.prisma.leaveBalanceLedger.findMany({
      where: { tenantId: user.tenantId, employeeId, year: query.year, ...(query.type ? { type: query.type } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { leaveRequest: { select: { id: true, type: true, startDate: true, endDate: true, status: true } } },
    });
  }

  create(user: AuthUser, dto: CreateLeaveRequestDto) { return this.requests.create(user, dto); }
  review(user: AuthUser, id: string, dto: ReviewLeaveDto) { return this.requests.review(user, id, dto); }
  cancel(user: AuthUser, id: string) { return this.requests.cancel(user, id); }
  listPolicies(tenantId: string) { return this.policies.list(tenantId); }
  listPolicyVersions(tenantId: string, type: string) { return this.policies.listVersions(tenantId, type); }
  upsertPolicy(tenantId: string, dto: LeavePolicyInput) { return this.policies.upsert(tenantId, dto); }
  listApprovalRules(tenantId: string) { return this.approvals.listRules(tenantId); }
  replaceApprovalRules(tenantId: string, dto: ReplaceApprovalRulesDto) { return this.approvals.replaceRules(tenantId, dto); }
  listApprovalDelegations(user: AuthUser) { return this.approvals.listDelegations(user); }
  createApprovalDelegation(user: AuthUser, dto: ApprovalDelegationDto) { return this.approvals.createDelegation(user, dto); }
  listHolidays(tenantId: string, year: number) { return this.calendar.listHolidays(tenantId, year); }
  addHoliday(tenantId: string, dto: { date: string; name: string }) { return this.calendar.addHoliday(tenantId, dto); }
  removeHoliday(tenantId: string, id: string) { return this.calendar.removeHoliday(tenantId, id); }
  accrueMonthly(tenantId: string, year: number, month: number) { return this.accruals.accrueMonthly(tenantId, year, month); }
  carryForward(tenantId: string, fromYear: number) { return this.accruals.carryForward(tenantId, fromYear); }
  runApprovalFollowUps() { return this.approvals.runFollowUps(); }
  workingDays(tenantId: string, start: Date, end: Date) { return this.calendar.workingDays(tenantId, start, end); }

  async runScheduledEntitlements() {
    const tenants = await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true, timezone: true } });
    const results: Array<{ tenantId: string; accrued: number; carried: number }> = [];
    for (const tenant of tenants) {
      const [year, month, day] = todayIn(tenant.timezone).split('-').map(Number);
      const accrual = await this.accruals.accrueMonthly(tenant.id, year, month);
      const carryForward = month === 1 && day <= 7 ? await this.accruals.carryForward(tenant.id, year - 1) : { carried: 0 };
      results.push({ tenantId: tenant.id, accrued: accrual.accrued, carried: carryForward.carried });
    }
    await this.approvals.runFollowUps();
    return results;
  }

  /** Admin-only, idempotent, append-only balance correction. */
  async adjustBalance(user: AuthUser, dto: AdjustLeaveBalanceDto) {
    const adjustmentKey = dto.adjustmentKey ?? randomUUID();
    const eventKey = `adjustment:${adjustmentKey}`;
    const result = await this.transactions.serializable(async (tx) => {
      const [employee, policy] = await Promise.all([
        tx.employee.findFirst({ where: { id: dto.employeeId, tenantId: user.tenantId } }),
        tx.leavePolicy.findUnique({ where: { tenantId_type: { tenantId: user.tenantId, type: dto.type } } }),
      ]);
      if (!employee || employee.status === 'EXITED') throw new NotFoundException('Employee not found');
      if (!policy?.isPaid) throw new BadRequestException('Balance adjustments are only available for paid leave policies');
      const existing = await tx.leaveBalanceLedger.findFirst({ where: { tenantId: user.tenantId, employeeId: employee.id, type: policy.type, year: dto.year, eventKey } });
      if (existing) return { entry: existing, created: false };
      await this.ledgerService.ensure(tx, user.tenantId, employee.id, policy, dto.year);
      if (!policy.allowNegative && dto.days < 0) {
        const available = await this.ledgerService.availableDays(tx, user.tenantId, employee.id, policy.type, dto.year);
        if (available + dto.days < 0) throw new BadRequestException('This adjustment would make the leave balance negative');
      }
      const entry = await tx.leaveBalanceLedger.create({ data: { tenantId: user.tenantId, employeeId: employee.id, type: policy.type, year: dto.year, event: 'ADJUSTMENT', eventKey, days: dto.days, metadata: { reason: dto.reason, adjustedByUserId: user.userId, adjustmentKey } } });
      return { entry, created: true };
    });
    if (result.created) await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'LEAVE_BALANCE_ADJUSTED', resource: 'leave-balance-ledger', resourceId: result.entry.id, newValues: { employeeId: dto.employeeId, type: dto.type, year: dto.year, days: dto.days, reason: dto.reason, adjustmentKey } });
    return result.entry;
  }

  private async assertCanActFor(user: AuthUser, employeeId: string) {
    if (employeeId === user.employeeId || can(user, 'leave.admin')) return;
    const isReport = user.employeeId ? await this.prisma.employee.count({ where: { id: employeeId, tenantId: user.tenantId, managerId: user.employeeId } }) : 0;
    if (!isReport) throw new ForbiddenException('You can only view your own or your team’s balances');
  }
}

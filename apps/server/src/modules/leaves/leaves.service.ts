import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EmailService } from '../../common/email/email.service';
import { EmailTemplates } from '../../common/email/templates';
import { SlackService } from '../integrations/slack.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginate, paged } from '../../common/validation/common.schemas';
import { countWorkingDays, parseDateOnly, toDateOnly, todayIn } from '../../common/utils/dates';
import type { AdjustLeaveBalanceDto, ApprovalDelegationDto, CreateLeaveRequestDto, LeaveLedgerQuery, ListLeavesQuery, ReplaceApprovalRulesDto, ReviewLeaveDto } from './dto/create-leave.dto';

const COUNTED = ['PENDING', 'APPROVED'];
export { LEAVE_PROCESSING_QUEUE } from '../../common/messaging/rabbitmq.service';

/** Distribute an integer annual quota over 12 two-decimal ledger events exactly. */
function monthlyAccrualAmount(annualQuota: number, month: number): number {
  const annualCents = annualQuota * 100;
  const baseCents = Math.floor(annualCents / 12);
  const remainder = annualCents % 12;
  return (baseCents + (month <= remainder ? 1 : 0)) / 100;
}

type ApprovalRuleSnapshot = {
  step: number;
  approverKind: 'DIRECT_MANAGER' | 'ROLE' | 'SPECIFIC_USER';
  approverRole?: 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  approverUserId?: string;
  reminderAfterHours: number;
  escalationAfterHours?: number;
};

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
    return Promise.all(policies.map(async (p) => {
      const used = sum(p.type, 'APPROVED');
      const pending = sum(p.type, 'PENDING');
      // Accounts created after the ledger migration use the ledger as the
      // source of truth. Older accounts continue to be calculated from their
      // requests until their next leave mutation seeds their opening balance.
      const ledger = p.isPaid
        ? await this.prisma.leaveBalanceLedger.aggregate({ where: { tenantId: user.tenantId, employeeId: targetId, type: p.type, year }, _sum: { days: true } })
        : null;
      const ledgerRemaining = ledger?._sum.days == null ? null : Number(ledger._sum.days);
      return {
        type: p.type,
        isPaid: p.isPaid,
        quota: p.isPaid ? p.annualQuota : null,
        used,
        pending,
        remaining: p.isPaid ? (ledgerRemaining ?? p.annualQuota - used - pending) : null,
      };
    }));
  }

  /** Explainable statement of every balance movement for an employee/year. */
  async ledger(user: AuthUser, q: LeaveLedgerQuery) {
    const employeeId = q.employeeId ?? user.employeeId;
    if (!employeeId) throw new NotFoundException('Your account is not linked to an employee profile');
    await this.assertCanActFor(user, employeeId, 'view');
    return this.prisma.leaveBalanceLedger.findMany({
      where: { tenantId: user.tenantId, employeeId, year: q.year, ...(q.type ? { type: q.type } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { leaveRequest: { select: { id: true, type: true, startDate: true, endDate: true, status: true } } },
    });
  }

  // ─── Commands ───────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateLeaveRequestDto) {
    const requestKey = dto.requestKey ?? randomUUID();
    const employeeId = dto.employeeId ?? user.employeeId;
    if (!employeeId) throw new BadRequestException('Your account is not linked to an employee profile');
    if (dto.employeeId && dto.employeeId !== user.employeeId && user.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can request leave on behalf of someone else');
    }

    const start = parseDateOnly(dto.startDate);
    const end = parseDateOnly(dto.endDate);
    if (start.getUTCFullYear() !== end.getUTCFullYear()) throw new BadRequestException('Split leave that crosses a year boundary into two requests');
    const horizon = Date.now() + 366 * 86_400_000;
    if (end.getTime() > horizon) throw new BadRequestException('Leave can be requested at most one year ahead');

    return this.serializable(async (tx) => {
      const existing = await tx.leaveRequest.findFirst({ where: { tenantId: user.tenantId, requestKey } });
      if (existing) return existing; // safe client retry after a timeout

      const [employee, policy, approvalRules] = await Promise.all([
        tx.employee.findFirst({ where: { id: employeeId, tenantId: user.tenantId } }),
        this.policyFor(tx, user.tenantId, dto.type, start),
        this.approvalRulesFor(tx, user.tenantId, dto.type),
      ]);
      if (!employee || employee.status === 'EXITED') throw new NotFoundException('Employee not found');
      if (!policy) throw new BadRequestException(`Unknown leave type ${dto.type}`);
      if (start < policy.effectiveFrom || (policy.effectiveTo && end > policy.effectiveTo)) {
        throw new BadRequestException(`The ${policy.type} policy is not effective for the requested dates`);
      }

      const days = await this.workingDaysWith(tx, user.tenantId, start, end);
      if (days === 0) throw new BadRequestException('The selected range has no working days');
      await this.assertPayrollOpen(tx, user.tenantId, employeeId, start, end);
      const overlapping = await tx.leaveRequest.count({ where: { tenantId: user.tenantId, employeeId, status: { in: COUNTED }, startDate: { lte: end }, endDate: { gte: start } } });
      if (overlapping) throw new ConflictException('This overlaps an existing pending or approved leave request');

      if (policy.isPaid) {
        await this.ensureLedger(tx, user.tenantId, employeeId, policy, start.getUTCFullYear());
        const available = await this.availableLedgerDays(tx, user.tenantId, employeeId, policy.type, start.getUTCFullYear());
        if (!policy.allowNegative && available < days) {
          throw new BadRequestException(`Insufficient ${policy.type} balance: ${Math.max(available, 0)} day(s) left, ${days} requested`);
        }
      }

      const leave = await tx.leaveRequest.create({
        data: {
          tenantId: user.tenantId,
          employeeId,
          type: policy.type,
          startDate: start,
          endDate: end,
          days,
          reason: dto.reason,
          status: 'PENDING',
          requestKey,
          policySnapshot: this.policySnapshot(policy),
          approvalSnapshot: approvalRules,
        },
      });
      if (policy.isPaid) {
        await tx.leaveBalanceLedger.create({
          data: { tenantId: user.tenantId, employeeId, leaveRequestId: leave.id, type: policy.type, year: start.getUTCFullYear(), event: 'RESERVATION', eventKey: `request:${leave.id}:reservation`, days: -days, metadata: { requestKey } },
        });
      }
      return leave;
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
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, email: true, managerId: true, userId: true, manager: { select: { userId: true } } } },
        approvals: { select: { step: true, decision: true }, orderBy: { step: 'asc' } },
      },
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.employeeId === user.employeeId) throw new ForbiddenException('You cannot approve your own leave');
    if (leave.status !== 'PENDING') throw new ConflictException(`This request is already ${leave.status.toLowerCase()}`);
    const initialRules = this.readApprovalSnapshot(leave.approvalSnapshot);
    const initialStep = initialRules.find((rule) => !leave.approvals.some((approval) => approval.step === rule.step && approval.decision === 'APPROVED'));
    if (!initialStep) throw new ConflictException('This request has already completed its approval workflow');
    if (!(await this.canApprove(this.prisma, user, leave.employee.managerId, leave.employee.manager?.userId ?? null, initialStep))) throw new ForbiddenException('You are not the current approver for this leave request');

    let outcome: { finalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'; step: number };
    try {
      outcome = await this.serializable(async (tx) => {
        const current = await tx.leaveRequest.findFirst({
          where: { id, tenantId: user.tenantId },
          include: { approvals: { select: { step: true, decision: true } } },
        });
        if (!current || current.status !== 'PENDING') throw new ConflictException('This request was already reviewed');
        const rules = this.readApprovalSnapshot(current.approvalSnapshot);
        const step = rules.find((rule) => !current.approvals.some((approval) => approval.step === rule.step && approval.decision === 'APPROVED'));
        if (!step) throw new ConflictException('This request has already completed its approval workflow');
        if (!(await this.canApprove(tx, user, leave.employee.managerId, leave.employee.manager?.userId ?? null, step))) throw new ForbiddenException('You are not the current approver for this leave request');
        const isFinalApproval = dto.status === 'APPROVED' && step.step === rules[rules.length - 1].step;
        const finalStatus = dto.status === 'REJECTED' ? 'REJECTED' : isFinalApproval ? 'APPROVED' : 'PENDING';
        if (finalStatus !== 'PENDING') await this.assertPayrollOpen(tx, user.tenantId, leave.employeeId, leave.startDate, leave.endDate);

        await tx.leaveApproval.create({ data: { tenantId: user.tenantId, leaveRequestId: id, step: step.step, approverId: user.userId, decision: dto.status, note: dto.note } });
        if (finalStatus !== 'PENDING') {
          const result = await tx.leaveRequest.updateMany({
            where: { id, tenantId: user.tenantId, status: 'PENDING' },
            data: { status: finalStatus, reviewedById: user.userId, reviewedAt: new Date(), reviewNote: dto.note },
          });
          if (!result.count) throw new ConflictException('This request was already reviewed');
        }
        const policy = await this.policyFor(tx, user.tenantId, leave.type, leave.startDate);
        if (finalStatus !== 'PENDING' && policy?.isPaid) {
          const year = leave.startDate.getUTCFullYear();
          await this.ensureLedger(tx, user.tenantId, leave.employeeId, policy, year);
          const events = finalStatus === 'APPROVED'
            ? [
                { event: 'RELEASE', eventKey: `request:${id}:approval-release`, days: leave.days },
                { event: 'CONSUMPTION', eventKey: `request:${id}:consumption`, days: -leave.days },
              ]
            : [{ event: 'RELEASE', eventKey: `request:${id}:rejection-release`, days: leave.days }];
          await tx.leaveBalanceLedger.createMany({ data: events.map((event) => ({ ...event, tenantId: user.tenantId, employeeId: leave.employeeId, leaveRequestId: id, type: leave.type, year })) });
        }
        return { finalStatus, step: step.step };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This approval step was already actioned');
      }
      throw error;
    }

    if (outcome.finalStatus === 'PENDING') {
      await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'LEAVE_APPROVAL_STEP_APPROVED', resource: 'leave-requests', resourceId: id, newValues: { step: outcome.step, note: dto.note } });
      return this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    }
    const employeeName = `${leave.employee.firstName} ${leave.employee.lastName}`.trim();
    const [from, to] = [toDateOnly(leave.startDate), toDateOnly(leave.endDate)];
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: `LEAVE_${outcome.finalStatus}`, resource: 'leave-requests', resourceId: id, oldValues: { status: 'PENDING' }, newValues: { status: outcome.finalStatus, note: dto.note } });
    await this.email.send({
      tenantId: user.tenantId,
      to: leave.employee.email,
      recipientUserId: leave.employee.userId,
      email: EmailTemplates.leaveDecision({ name: leave.employee.firstName, status: outcome.finalStatus, type: leave.type, from, to, note: dto.note }),
    });
    void this.slack.leaveDecision(user.tenantId, { employeeName, type: leave.type, from, to, days: leave.days, status: outcome.finalStatus, approvedBy: user.name || user.email });

    return this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
  }

  /** Employees cancel their own pending requests; admins may also cancel approved leave that has not started. */
  async cancel(user: AuthUser, id: string) {
    const leave = await this.prisma.leaveRequest.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!leave) throw new NotFoundException('Leave request not found');
    const own = leave.employeeId === user.employeeId;
    const cancellable = leave.status === 'PENDING' || (leave.status === 'APPROVED' && user.role === 'ADMIN' && leave.startDate > new Date());
    if ((!own && user.role !== 'ADMIN') || !cancellable) throw new ForbiddenException('This request can no longer be cancelled');
    return this.serializable(async (tx) => {
      const result = await tx.leaveRequest.updateMany({ where: { id, tenantId: user.tenantId, status: leave.status }, data: { status: 'CANCELLED' } });
      if (!result.count) throw new ConflictException('This request changed before it could be cancelled');
      await this.assertPayrollOpen(tx, user.tenantId, leave.employeeId, leave.startDate, leave.endDate);
      const policy = await this.policyFor(tx, user.tenantId, leave.type, leave.startDate);
      if (policy?.isPaid) {
        const year = leave.startDate.getUTCFullYear();
        await this.ensureLedger(tx, user.tenantId, leave.employeeId, policy, year);
        const event = leave.status === 'PENDING' ? 'RELEASE' : 'REVERSAL';
        await tx.leaveBalanceLedger.create({ data: { tenantId: user.tenantId, employeeId: leave.employeeId, leaveRequestId: id, type: leave.type, year, event, eventKey: `request:${id}:cancel-${leave.status.toLowerCase()}`, days: leave.days } });
      }
      return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  // ─── Policies & holidays ────────────────────────────────────────────────────

  listPolicies(tenantId: string) {
    return this.prisma.leavePolicy.findMany({ where: { tenantId }, orderBy: { type: 'asc' } });
  }

  async listPolicyVersions(tenantId: string, type: string) {
    const policy = await this.prisma.leavePolicy.findUnique({ where: { tenantId_type: { tenantId, type } } });
    if (!policy) throw new NotFoundException('Leave policy not found');
    return this.prisma.leavePolicyVersion.findMany({ where: { tenantId, leavePolicyId: policy.id }, orderBy: { version: 'desc' } });
  }

  async upsertPolicy(tenantId: string, dto: { type: string; annualQuota: number; isPaid: boolean; accrualMode: string; carryForwardLimit?: number | null; allowNegative: boolean; effectiveFrom?: string; effectiveTo?: string }) {
    const effectiveFrom = dto.effectiveFrom ? parseDateOnly(dto.effectiveFrom) : parseDateOnly(new Date().toISOString().slice(0, 10));
    const effectiveTo = dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null;
    return this.serializable(async (tx) => {
      const existing = await tx.leavePolicy.findUnique({ where: { tenantId_type: { tenantId, type: dto.type } } });
      const values = {
        annualQuota: dto.annualQuota,
        isPaid: dto.isPaid,
        accrualMode: dto.accrualMode,
        carryForwardLimit: dto.carryForwardLimit,
        allowNegative: dto.allowNegative,
        effectiveFrom,
        effectiveTo,
      };
      if (!existing) {
        const policy = await tx.leavePolicy.create({ data: { tenantId, type: dto.type, ...values } });
        await tx.leavePolicyVersion.create({ data: { tenantId, leavePolicyId: policy.id, version: 1, ...values } });
        return policy;
      }

      const current = await tx.leavePolicyVersion.findFirst({ where: { leavePolicyId: existing.id }, orderBy: { version: 'desc' } });
      if (!current) throw new ConflictException('Policy history is missing; apply the leave ledger migration before changing this policy');
      const unchanged = current.annualQuota === dto.annualQuota && current.isPaid === dto.isPaid && current.accrualMode === dto.accrualMode
        && Number(current.carryForwardLimit ?? 0) === Number(dto.carryForwardLimit ?? 0) && current.allowNegative === dto.allowNegative
        && current.effectiveFrom.getTime() === effectiveFrom.getTime() && (current.effectiveTo?.getTime() ?? null) === (effectiveTo?.getTime() ?? null);
      if (unchanged) return existing;
      if (effectiveFrom <= current.effectiveFrom) throw new ConflictException('A changed policy must begin after the latest policy version. Use a future effectiveFrom date.');
      if (current.effectiveTo && effectiveFrom > current.effectiveTo) throw new ConflictException('The new policy version begins after the current policy has ended. Extend the current policy or use a contiguous effectiveFrom date.');
      const priorEnd = new Date(effectiveFrom);
      priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
      await tx.leavePolicyVersion.update({ where: { leavePolicyId_version: { leavePolicyId: existing.id, version: current.version } }, data: { effectiveTo: priorEnd } });
      await tx.leavePolicyVersion.create({ data: { tenantId, leavePolicyId: existing.id, version: current.version + 1, ...values } });
      return tx.leavePolicy.update({ where: { id: existing.id }, data: values });
    });
  }

  listApprovalRules(tenantId: string) {
    return this.prisma.leaveApprovalRule.findMany({ where: { tenantId, isActive: true }, orderBy: [{ type: 'asc' }, { step: 'asc' }] });
  }

  async replaceApprovalRules(tenantId: string, dto: ReplaceApprovalRulesDto) {
    const specificUsers = dto.rules.filter((rule) => rule.approverKind === 'SPECIFIC_USER').map((rule) => rule.approverUserId!);
    if (specificUsers.length) {
      const users = await this.prisma.user.count({ where: { tenantId, id: { in: specificUsers }, isActive: true } });
      if (users !== new Set(specificUsers).size) throw new BadRequestException('Every named approver must be an active user in this tenant');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.leaveApprovalRule.deleteMany({ where: { tenantId, type: dto.type } });
      await tx.leaveApprovalRule.createMany({
        data: dto.rules.map((rule) => ({
          tenantId,
          type: dto.type,
          step: rule.step,
          approverKind: rule.approverKind,
          approverRole: rule.approverKind === 'ROLE' ? rule.approverRole : null,
          approverUserId: rule.approverKind === 'SPECIFIC_USER' ? rule.approverUserId : null,
        })),
      });
      return tx.leaveApprovalRule.findMany({ where: { tenantId, type: dto.type }, orderBy: { step: 'asc' } });
    });
  }

  listApprovalDelegations(user: AuthUser) {
    return this.prisma.leaveApprovalDelegation.findMany({
      where: { tenantId: user.tenantId, OR: [{ delegatorId: user.userId }, { delegateId: user.userId }] },
      include: { delegator: { select: { id: true, name: true, email: true } }, delegate: { select: { id: true, name: true, email: true } } },
      orderBy: { startsAt: 'desc' },
    });
  }

  async createApprovalDelegation(user: AuthUser, dto: ApprovalDelegationDto) {
    if (dto.delegateUserId === user.userId) throw new BadRequestException('You cannot delegate approval to yourself');
    const delegate = await this.prisma.user.findFirst({ where: { id: dto.delegateUserId, tenantId: user.tenantId, isActive: true } });
    if (!delegate) throw new NotFoundException('Delegate must be an active user in this tenant');
    const delegation = await this.prisma.leaveApprovalDelegation.upsert({
      where: { tenantId_delegatorId_delegateId_startsAt: { tenantId: user.tenantId, delegatorId: user.userId, delegateId: dto.delegateUserId, startsAt: parseDateOnly(dto.startsAt) } },
      update: { endsAt: dto.endsAt ? parseDateOnly(dto.endsAt) : null, isActive: true },
      create: { tenantId: user.tenantId, delegatorId: user.userId, delegateId: dto.delegateUserId, startsAt: parseDateOnly(dto.startsAt), endsAt: dto.endsAt ? parseDateOnly(dto.endsAt) : null },
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'LEAVE_APPROVAL_DELEGATED', resource: 'leave-approval-delegations', resourceId: delegation.id, newValues: { delegateUserId: dto.delegateUserId, startsAt: dto.startsAt, endsAt: dto.endsAt } });
    return delegation;
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

  /**
   * Idempotent monthly entitlement run. Invoke from the platform scheduler on
   * the first day of each month; the event key makes retries harmless.
   */
  async accrueMonthly(tenantId: string, year: number, month: number) {
    if (month < 1 || month > 12) throw new BadRequestException('month must be between 1 and 12');
    const asOf = new Date(Date.UTC(year, month - 1, 1));
    const [policyVersions, employees] = await Promise.all([
      this.prisma.leavePolicyVersion.findMany({ where: { tenantId, isPaid: true, accrualMode: 'MONTHLY', effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] }, include: { leavePolicy: { select: { type: true } } } }),
      this.prisma.employee.findMany({ where: { tenantId, status: { not: 'EXITED' }, OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: asOf } }] }, select: { id: true } }),
    ]);
    let accrued = 0;
    for (const version of policyVersions) {
      const policy = { ...version, type: version.leavePolicy.type };
      for (const employee of employees) {
        const created = await this.serializable(async (tx) => {
          await this.ensureLedger(tx, tenantId, employee.id, policy, year);
          const event = await tx.leaveBalanceLedger.createMany({
            data: [{ tenantId, employeeId: employee.id, type: policy.type, year, event: 'ACCRUAL', eventKey: `accrual:${year}-${String(month).padStart(2, '0')}`, days: monthlyAccrualAmount(policy.annualQuota, month), metadata: { source: 'monthly-accrual' } }],
            skipDuplicates: true,
          });
          return event.count;
        });
        accrued += created;
      }
    }
    return { year, month, policies: policyVersions.length, employees: employees.length, accrued };
  }

  /** Carries an unused balance into the next calendar year once, bounded by policy. */
  async carryForward(tenantId: string, fromYear: number) {
    const asOf = new Date(Date.UTC(fromYear, 11, 31));
    const policyVersions = await this.prisma.leavePolicyVersion.findMany({
      where: { tenantId, isPaid: true, carryForwardLimit: { gt: 0 }, effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] },
      include: { leavePolicy: { select: { type: true } } },
    });
    const employees = await this.prisma.employee.findMany({ where: { tenantId, status: { not: 'EXITED' } }, select: { id: true } });
    let carried = 0;
    for (const version of policyVersions) {
      const policy = { ...version, type: version.leavePolicy.type };
      for (const employee of employees) {
        const created = await this.serializable(async (tx) => {
          await this.ensureLedger(tx, tenantId, employee.id, policy, fromYear);
          await this.ensureLedger(tx, tenantId, employee.id, policy, fromYear + 1);
          const available = await this.availableLedgerDays(tx, tenantId, employee.id, policy.type, fromYear);
          const amount = Math.min(Math.max(available, 0), Number(policy.carryForwardLimit));
          if (!amount) return 0;
          const event = await tx.leaveBalanceLedger.createMany({
            data: [{ tenantId, employeeId: employee.id, type: policy.type, year: fromYear + 1, event: 'CARRY_FORWARD', eventKey: `carry-forward:${fromYear}`, days: amount, metadata: { sourceYear: fromYear } }],
            skipDuplicates: true,
          });
          return event.count;
        });
        carried += created;
      }
    }
    return { fromYear, toYear: fromYear + 1, policies: policyVersions.length, employees: employees.length, carried };
  }

  /**
   * Safe to call repeatedly. The worker invokes this daily so a temporary
   * outage on the first of a month cannot leave entitlements unprocessed.
   */
  async runScheduledEntitlements() {
    const tenants = await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true, timezone: true } });
    const results: Array<{ tenantId: string; accrued: number; carried: number }> = [];
    for (const tenant of tenants) {
      const [year, month, day] = todayIn(tenant.timezone).split('-').map(Number);
      const accrual = await this.accrueMonthly(tenant.id, year, month);
      const carryForward = month === 1 && day <= 7 ? await this.carryForward(tenant.id, year - 1) : { carried: 0 };
      results.push({ tenantId: tenant.id, accrued: accrual.accrued, carried: carryForward.carried });
    }
    await this.runApprovalFollowUps();
    return results;
  }

  /** Queues one reminder and, where configured, one escalation for each overdue step. */
  async runApprovalFollowUps() {
    const requests = await this.prisma.leaveRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        employee: { include: { manager: { include: { user: { select: { id: true, email: true, name: true } } } } } },
        approvals: { select: { step: true, decision: true, actedAt: true } },
      },
    });
    let queued = 0;
    for (const request of requests) {
      const rules = this.readApprovalSnapshot(request.approvalSnapshot);
      const current = rules.find((rule) => !request.approvals.some((approval) => approval.step === rule.step && approval.decision === 'APPROVED'));
      if (!current) continue;
      const lastAction = request.approvals.reduce((latest, approval) => approval.actedAt > latest ? approval.actedAt : latest, request.createdAt);
      const elapsedHours = (Date.now() - lastAction.getTime()) / 3_600_000;
      const kinds: Array<'REMINDER' | 'ESCALATION'> = [];
      if (elapsedHours >= current.reminderAfterHours) kinds.push('REMINDER');
      if (current.escalationAfterHours && elapsedHours >= current.escalationAfterHours) kinds.push('ESCALATION');
      for (const kind of kinds) {
        try {
          await this.prisma.leaveApprovalFollowUp.create({ data: { tenantId: request.tenantId, leaveRequestId: request.id, step: current.step, kind } });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
          throw error;
        }
        const recipients = await this.followUpRecipients(request.tenantId, request.employee.manager?.user?.id ?? null, current, kind);
        const subject = kind === 'REMINDER' ? `Leave approval reminder: ${request.type}` : `Leave approval escalation: ${request.type}`;
        await Promise.all(recipients.map((recipient) => this.email.send({
          tenantId: request.tenantId,
          to: recipient.email,
          recipientUserId: recipient.id,
          email: {
            subject,
            text: `${request.employee.firstName} ${request.employee.lastName} has a pending ${request.type} leave request requiring approval at step ${current.step}.`,
            html: `<p><strong>${request.employee.firstName} ${request.employee.lastName}</strong> has a pending <strong>${request.type}</strong> leave request requiring approval at step ${current.step}.</p>`,
          },
        })));
        queued += recipients.length;
      }
    }
    return { requests: requests.length, queued };
  }

  /** An admin-only, append-only correction for imports and documented policy transitions. */
  async adjustBalance(user: AuthUser, dto: AdjustLeaveBalanceDto) {
    const adjustmentKey = dto.adjustmentKey ?? randomUUID();
    const eventKey = `adjustment:${adjustmentKey}`;
    const result = await this.serializable(async (tx) => {
      const [employee, policy] = await Promise.all([
        tx.employee.findFirst({ where: { id: dto.employeeId, tenantId: user.tenantId } }),
        tx.leavePolicy.findUnique({ where: { tenantId_type: { tenantId: user.tenantId, type: dto.type } } }),
      ]);
      if (!employee || employee.status === 'EXITED') throw new NotFoundException('Employee not found');
      if (!policy?.isPaid) throw new BadRequestException('Balance adjustments are only available for paid leave policies');

      const existing = await tx.leaveBalanceLedger.findFirst({ where: { tenantId: user.tenantId, employeeId: employee.id, type: policy.type, year: dto.year, eventKey } });
      if (existing) return { entry: existing, created: false };

      await this.ensureLedger(tx, user.tenantId, employee.id, policy, dto.year);
      if (!policy.allowNegative && dto.days < 0) {
        const available = await this.availableLedgerDays(tx, user.tenantId, employee.id, policy.type, dto.year);
        if (available + dto.days < 0) throw new BadRequestException('This adjustment would make the leave balance negative');
      }
      const entry = await tx.leaveBalanceLedger.create({
        data: {
          tenantId: user.tenantId,
          employeeId: employee.id,
          type: policy.type,
          year: dto.year,
          event: 'ADJUSTMENT',
          eventKey,
          days: dto.days,
          metadata: { reason: dto.reason, adjustedByUserId: user.userId, adjustmentKey },
        },
      });
      return { entry, created: true };
    });
    if (result.created) {
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'LEAVE_BALANCE_ADJUSTED',
        resource: 'leave-balance-ledger',
        resourceId: result.entry.id,
        newValues: { employeeId: dto.employeeId, type: dto.type, year: dto.year, days: dto.days, reason: dto.reason, adjustmentKey },
      });
    }
    return result.entry;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async workingDays(tenantId: string, start: Date, end: Date): Promise<number> {
    return this.workingDaysWith(this.prisma, tenantId, start, end);
  }

  private async workingDaysWith(db: Prisma.TransactionClient | PrismaService, tenantId: string, start: Date, end: Date): Promise<number> {
    const holidays = await db.holiday.findMany({ where: { tenantId, date: { gte: start, lte: end } }, select: { date: true } });
    return countWorkingDays(start, end, new Set(holidays.map((h) => toDateOnly(h.date))));
  }

  /** Leave mutations cannot silently alter a month whose payroll is finalized. */
  private async assertPayrollOpen(tx: Prisma.TransactionClient, tenantId: string, employeeId: string, start: Date, end: Date) {
    const periods: Array<{ year: number; month: number }> = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (cursor <= last) {
      periods.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const finalized = await tx.payslip.findFirst({ where: { tenantId, employeeId, status: 'FINALIZED', OR: periods } });
    if (finalized) throw new ConflictException(`Payroll is finalized for ${finalized.year}-${String(finalized.month).padStart(2, '0')}. Submit a payroll correction instead of changing leave directly.`);
  }

  private async approvalRulesFor(db: Prisma.TransactionClient | PrismaService, tenantId: string, type: string): Promise<ApprovalRuleSnapshot[]> {
    const rules = await db.leaveApprovalRule.findMany({ where: { tenantId, type, isActive: true }, orderBy: { step: 'asc' } });
    if (!rules.length) return [{ step: 1, approverKind: 'DIRECT_MANAGER', reminderAfterHours: 24 }];
    return rules.map((rule) => ({
      step: rule.step,
      approverKind: rule.approverKind as ApprovalRuleSnapshot['approverKind'],
      ...(rule.approverRole ? { approverRole: rule.approverRole as ApprovalRuleSnapshot['approverRole'] } : {}),
      ...(rule.approverUserId ? { approverUserId: rule.approverUserId } : {}),
      reminderAfterHours: rule.reminderAfterHours,
      ...(rule.escalationAfterHours ? { escalationAfterHours: rule.escalationAfterHours } : {}),
    }));
  }

  private readApprovalSnapshot(snapshot: Prisma.JsonValue | null): ApprovalRuleSnapshot[] {
    if (!Array.isArray(snapshot) || !snapshot.length) return [{ step: 1, approverKind: 'DIRECT_MANAGER', reminderAfterHours: 24 }];
    const rules = snapshot.filter((value): value is Prisma.JsonObject => !!value && typeof value === 'object' && !Array.isArray(value)).map((value) => ({
      step: typeof value.step === 'number' ? value.step : 0,
      approverKind: value.approverKind,
      approverRole: value.approverRole,
      approverUserId: value.approverUserId,
      reminderAfterHours: typeof value.reminderAfterHours === 'number' ? value.reminderAfterHours : 24,
      escalationAfterHours: typeof value.escalationAfterHours === 'number' ? value.escalationAfterHours : undefined,
    }));
    if (!rules.length || rules.some((rule, index) => rule.step !== index + 1 || !['DIRECT_MANAGER', 'ROLE', 'SPECIFIC_USER'].includes(String(rule.approverKind)))) {
      return [{ step: 1, approverKind: 'DIRECT_MANAGER', reminderAfterHours: 24 }];
    }
    return rules as ApprovalRuleSnapshot[];
  }

  private async canApprove(db: Prisma.TransactionClient | PrismaService, user: AuthUser, managerId: string | null, managerUserId: string | null, rule: ApprovalRuleSnapshot): Promise<boolean> {
    if (user.role === 'ADMIN') return true; // documented HR override
    if (rule.approverKind === 'DIRECT_MANAGER') {
      if (!!user.employeeId && user.employeeId === managerId) return true;
      return !!managerUserId && this.isActiveDelegate(db, user.tenantId, managerUserId, user.userId);
    }
    if (rule.approverKind === 'ROLE') return user.role === rule.approverRole;
    if (user.userId === rule.approverUserId) return true;
    return !!rule.approverUserId && this.isActiveDelegate(db, user.tenantId, rule.approverUserId, user.userId);
  }

  private async isActiveDelegate(db: Prisma.TransactionClient | PrismaService, tenantId: string, delegatorId: string, delegateId: string): Promise<boolean> {
    const today = parseDateOnly(new Date().toISOString().slice(0, 10));
    return !!(await db.leaveApprovalDelegation.count({ where: { tenantId, delegatorId, delegateId, isActive: true, startsAt: { lte: today }, OR: [{ endsAt: null }, { endsAt: { gte: today } }] } }));
  }

  private async followUpRecipients(tenantId: string, managerUserId: string | null, rule: ApprovalRuleSnapshot, kind: 'REMINDER' | 'ESCALATION') {
    if (kind === 'ESCALATION') {
      return this.prisma.user.findMany({ where: { tenantId, role: 'ADMIN', isActive: true }, select: { id: true, email: true, name: true } });
    }
    if (rule.approverKind === 'DIRECT_MANAGER') {
      return managerUserId ? this.prisma.user.findMany({ where: { id: managerUserId, tenantId, isActive: true }, select: { id: true, email: true, name: true } }) : [];
    }
    if (rule.approverKind === 'SPECIFIC_USER') {
      return rule.approverUserId ? this.prisma.user.findMany({ where: { id: rule.approverUserId, tenantId, isActive: true }, select: { id: true, email: true, name: true } }) : [];
    }
    return this.prisma.user.findMany({ where: { tenantId, role: rule.approverRole, isActive: true }, select: { id: true, email: true, name: true } });
  }

  /** Resolves the immutable entitlement terms that apply on a calendar date. */
  private async policyFor(db: Prisma.TransactionClient | PrismaService, tenantId: string, type: string, date: Date) {
    const policy = await db.leavePolicy.findUnique({ where: { tenantId_type: { tenantId, type } } });
    if (!policy) return null;
    const version = await db.leavePolicyVersion.findFirst({
      where: { leavePolicyId: policy.id, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
      orderBy: { version: 'desc' },
    });
    if (!version) return policy; // compatibility for tenants created before policy-versioning
    return {
      ...policy,
      annualQuota: version.annualQuota,
      isPaid: version.isPaid,
      accrualMode: version.accrualMode,
      carryForwardLimit: version.carryForwardLimit,
      allowNegative: version.allowNegative,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
    };
  }

  private async ensureLedger(tx: Prisma.TransactionClient, tenantId: string, employeeId: string, policy: { type: string; annualQuota: number; isPaid: boolean; accrualMode: string }, year: number) {
    const count = await tx.leaveBalanceLedger.count({ where: { tenantId, employeeId, type: policy.type, year } });
    if (count || !policy.isPaid) return;
    const historical = await tx.leaveRequest.findMany({
      where: { tenantId, employeeId, type: policy.type, status: { in: COUNTED }, startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      select: { id: true, status: true, days: true },
    });
    await tx.leaveBalanceLedger.createMany({
      data: [
        { tenantId, employeeId, type: policy.type, year, event: 'OPENING_BALANCE', eventKey: 'opening-balance', days: policy.accrualMode === 'ANNUAL_GRANT' ? policy.annualQuota : 0, metadata: { migrated: true } },
        ...historical.map((leave) => ({ tenantId, employeeId, type: policy.type, year, leaveRequestId: leave.id, event: leave.status === 'PENDING' ? 'RESERVATION' : 'CONSUMPTION', eventKey: `migration:${leave.id}:${leave.status.toLowerCase()}`, days: -leave.days, metadata: { migrated: true } })),
      ],
      skipDuplicates: true,
    });
  }

  private async availableLedgerDays(tx: Prisma.TransactionClient, tenantId: string, employeeId: string, type: string, year: number): Promise<number> {
    const total = await tx.leaveBalanceLedger.aggregate({ where: { tenantId, employeeId, type, year }, _sum: { days: true } });
    return Number(total._sum.days ?? 0);
  }

  private policySnapshot(policy: { id: string; type: string; annualQuota: number; isPaid: boolean; accrualMode: string; carryForwardLimit: Prisma.Decimal | null; allowNegative: boolean; effectiveFrom: Date; effectiveTo: Date | null }): Prisma.InputJsonValue {
    return {
      policyId: policy.id,
      type: policy.type,
      annualQuota: policy.annualQuota,
      isPaid: policy.isPaid,
      accrualMode: policy.accrualMode,
      carryForwardLimit: policy.carryForwardLimit ? Number(policy.carryForwardLimit) : null,
      allowNegative: policy.allowNegative,
      effectiveFrom: policy.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: policy.effectiveTo?.toISOString().slice(0, 10) ?? null,
    };
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 2) throw error;
      }
    }
    throw new Error('Unreachable');
  }

  private async assertCanActFor(user: AuthUser, employeeId: string, _action: 'view') {
    if (employeeId === user.employeeId || user.role === 'ADMIN') return;
    const isReport = user.employeeId
      ? await this.prisma.employee.count({ where: { id: employeeId, tenantId: user.tenantId, managerId: user.employeeId } })
      : 0;
    if (!isReport) throw new ForbiddenException('You can only view your own or your team’s balances');
  }
}

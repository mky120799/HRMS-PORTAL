import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { EmailTemplates } from '../../common/email/templates';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseDateOnly, toDateOnly } from '../../common/utils/dates';
import { SlackService } from '../integrations/slack.service';
import { NotificationPublisherService } from '../notifications/notification-publisher.service';
import type {
  CreateLeaveRequestDto,
  ReviewLeaveDto,
} from './dto/create-leave.dto';
import { LeaveApprovalService } from './leave-approval.service';
import { LeaveCalendarService } from './leave-calendar.service';
import { LeaveLedgerService } from './leave-ledger.service';
import { LeavePayrollService } from './leave-payroll.service';
import { LeavePolicyService } from './leave-policy.service';
import { LeaveTransactionService } from './leave-transaction.service';

const COUNTED = ['PENDING', 'APPROVED'];

/** Creates and transitions leave requests; its collaborators own the domain sub-concerns. */
@Injectable()
export class LeaveRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationPublisherService,
    private readonly slack: SlackService,
    private readonly calendar: LeaveCalendarService,
    private readonly approvals: LeaveApprovalService,
    private readonly ledger: LeaveLedgerService,
    private readonly payroll: LeavePayrollService,
    private readonly policies: LeavePolicyService,
    private readonly transactions: LeaveTransactionService,
  ) {}

  async create(user: AuthUser, dto: CreateLeaveRequestDto) {
    const requestKey = dto.requestKey ?? randomUUID();
    const employeeId = dto.employeeId ?? user.employeeId;
    if (!employeeId)
      throw new BadRequestException(
        'Your account is not linked to an employee profile',
      );
    if (
      dto.employeeId &&
      dto.employeeId !== user.employeeId &&
      user.role !== 'ADMIN'
    )
      throw new ForbiddenException(
        'Only admins can request leave on behalf of someone else',
      );

    const start = parseDateOnly(dto.startDate);
    const end = parseDateOnly(dto.endDate);
    if (start.getUTCFullYear() !== end.getUTCFullYear())
      throw new BadRequestException(
        'Split leave that crosses a year boundary into two requests',
      );
    if (end.getTime() > Date.now() + 366 * 86_400_000)
      throw new BadRequestException(
        'Leave can be requested at most one year ahead',
      );

    return this.transactions.serializable(async (tx) => {
      const existing = await tx.leaveRequest.findFirst({
        where: { tenantId: user.tenantId, requestKey },
      });
      if (existing) return existing;
      const [employee, policy, approvalRules] = await Promise.all([
        tx.employee.findFirst({
          where: { id: employeeId, tenantId: user.tenantId },
        }),
        this.policies.forDate(tx, user.tenantId, dto.type, start),
        this.approvals.rulesFor(tx, user.tenantId, dto.type),
      ]);
      if (!employee || employee.status === 'EXITED')
        throw new NotFoundException('Employee not found');
      if (!policy)
        throw new BadRequestException(`Unknown leave type ${dto.type}`);
      if (
        start < policy.effectiveFrom ||
        (policy.effectiveTo && end > policy.effectiveTo)
      )
        throw new BadRequestException(
          `The ${policy.type} policy is not effective for the requested dates`,
        );

      const days = await this.calendar.workingDaysWith(
        tx,
        user.tenantId,
        start,
        end,
      );
      if (days === 0)
        throw new BadRequestException('The selected range has no working days');
      await this.payroll.assertOpen(tx, user.tenantId, employeeId, start, end);
      const overlapping = await tx.leaveRequest.count({
        where: {
          tenantId: user.tenantId,
          employeeId,
          status: { in: COUNTED },
          startDate: { lte: end },
          endDate: { gte: start },
        },
      });
      if (overlapping)
        throw new ConflictException(
          'This overlaps an existing pending or approved leave request',
        );

      if (policy.isPaid) {
        await this.ledger.ensure(
          tx,
          user.tenantId,
          employeeId,
          policy,
          start.getUTCFullYear(),
        );
        const available = await this.ledger.availableDays(
          tx,
          user.tenantId,
          employeeId,
          policy.type,
          start.getUTCFullYear(),
        );
        if (!policy.allowNegative && available < days)
          throw new BadRequestException(
            `Insufficient ${policy.type} balance: ${Math.max(available, 0)} day(s) left, ${days} requested`,
          );
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
          policySnapshot: this.policies.snapshot(policy),
          approvalSnapshot: approvalRules,
        },
      });
      if (policy.isPaid)
        await tx.leaveBalanceLedger.create({
          data: {
            tenantId: user.tenantId,
            employeeId,
            leaveRequestId: leave.id,
            type: policy.type,
            year: start.getUTCFullYear(),
            event: 'RESERVATION',
            eventKey: `request:${leave.id}:reservation`,
            days: -days,
            metadata: { requestKey },
          },
        });
      return leave;
    });
  }

  async review(user: AuthUser, id: string, dto: ReviewLeaveDto) {
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            managerId: true,
            userId: true,
            manager: { select: { userId: true } },
          },
        },
        approvals: {
          select: { step: true, decision: true },
          orderBy: { step: 'asc' },
        },
      },
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.employeeId === user.employeeId)
      throw new ForbiddenException('You cannot approve your own leave');
    if (leave.status !== 'PENDING')
      throw new ConflictException(
        `This request is already ${leave.status.toLowerCase()}`,
      );
    const initialRules = this.approvals.rulesFromSnapshot(
      leave.approvalSnapshot,
    );
    const initialStep = initialRules.find(
      (rule) =>
        !leave.approvals.some(
          (approval) =>
            approval.step === rule.step && approval.decision === 'APPROVED',
        ),
    );
    if (!initialStep)
      throw new ConflictException(
        'This request has already completed its approval workflow',
      );
    if (
      !(await this.approvals.canApprove(
        this.prisma,
        user,
        leave.employee.managerId,
        leave.employee.manager?.userId ?? null,
        initialStep,
      ))
    )
      throw new ForbiddenException(
        'You are not the current approver for this leave request',
      );

    const employeeName =
      `${leave.employee.firstName} ${leave.employee.lastName}`.trim();
    const [from, to] = [toDateOnly(leave.startDate), toDateOnly(leave.endDate)];

    let outcome: {
      finalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
      step: number;
    };
    try {
      outcome = await this.transactions.serializable(async (tx) => {
        const current = await tx.leaveRequest.findFirst({
          where: { id, tenantId: user.tenantId },
          include: { approvals: { select: { step: true, decision: true } } },
        });
        if (!current || current.status !== 'PENDING')
          throw new ConflictException('This request was already reviewed');
        const rules = this.approvals.rulesFromSnapshot(
          current.approvalSnapshot,
        );
        const step = rules.find(
          (rule) =>
            !current.approvals.some(
              (approval) =>
                approval.step === rule.step && approval.decision === 'APPROVED',
            ),
        );
        if (!step)
          throw new ConflictException(
            'This request has already completed its approval workflow',
          );
        if (
          !(await this.approvals.canApprove(
            tx,
            user,
            leave.employee.managerId,
            leave.employee.manager?.userId ?? null,
            step,
          ))
        )
          throw new ForbiddenException(
            'You are not the current approver for this leave request',
          );
        const isFinalApproval =
          dto.status === 'APPROVED' &&
          step.step === rules[rules.length - 1].step;
        const finalStatus =
          dto.status === 'REJECTED'
            ? 'REJECTED'
            : isFinalApproval
              ? 'APPROVED'
              : 'PENDING';
        if (finalStatus !== 'PENDING')
          await this.payroll.assertOpen(
            tx,
            user.tenantId,
            leave.employeeId,
            leave.startDate,
            leave.endDate,
          );
        await tx.leaveApproval.create({
          data: {
            tenantId: user.tenantId,
            leaveRequestId: id,
            step: step.step,
            approverId: user.userId,
            decision: dto.status,
            note: dto.note,
          },
        });
        if (finalStatus !== 'PENDING') {
          const result = await tx.leaveRequest.updateMany({
            where: { id, tenantId: user.tenantId, status: 'PENDING' },
            data: {
              status: finalStatus,
              reviewedById: user.userId,
              reviewedAt: new Date(),
              reviewNote: dto.note,
            },
          });
          if (!result.count)
            throw new ConflictException('This request was already reviewed');
        }
        const policy = await this.policies.forDate(
          tx,
          user.tenantId,
          leave.type,
          leave.startDate,
        );
        if (finalStatus !== 'PENDING' && policy?.isPaid) {
          const year = leave.startDate.getUTCFullYear();
          await this.ledger.ensure(
            tx,
            user.tenantId,
            leave.employeeId,
            policy,
            year,
          );
          const events =
            finalStatus === 'APPROVED'
              ? [
                  {
                    event: 'RELEASE',
                    eventKey: `request:${id}:approval-release`,
                    days: leave.days,
                  },
                  {
                    event: 'CONSUMPTION',
                    eventKey: `request:${id}:consumption`,
                    days: -leave.days,
                  },
                ]
              : [
                  {
                    event: 'RELEASE',
                    eventKey: `request:${id}:rejection-release`,
                    days: leave.days,
                  },
                ];
          await tx.leaveBalanceLedger.createMany({
            data: events.map((event) => ({
              ...event,
              tenantId: user.tenantId,
              employeeId: leave.employeeId,
              leaveRequestId: id,
              type: leave.type,
              year,
            })),
          });
        }
        if (finalStatus !== 'PENDING') {
          const eventType = `LEAVE_${finalStatus}`;
          await this.notifications.publish(tx, {
            tenantId: user.tenantId,
            eventKey: `leave-decision:${id}:${finalStatus}`,
            eventType,
            category: 'LEAVE',
            actorUserId: user.userId,
            data: {
              leaveRequestId: id,
              employeeId: leave.employeeId,
              status: finalStatus,
              type: leave.type,
              from,
              to,
              days: leave.days,
              note: dto.note ?? null,
            },
            recipients: [
              {
                userId: leave.employee.userId,
                email: leave.employee.email,
              },
            ],
            channels: ['IN_APP', 'EMAIL'],
            title: `Leave request ${finalStatus.toLowerCase()}`,
            body: `Your ${leave.type} leave from ${from} to ${to} was ${finalStatus.toLowerCase()}.`,
            link: '/leave',
            email: EmailTemplates.leaveDecision({
              name: leave.employee.firstName,
              status: finalStatus,
              type: leave.type,
              from,
              to,
              note: dto.note,
            }),
          });
        }
        return { finalStatus, step: step.step };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('This approval step was already actioned');
      throw error;
    }
    if (outcome.finalStatus === 'PENDING') {
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'LEAVE_APPROVAL_STEP_APPROVED',
        resource: 'leave-requests',
        resourceId: id,
        newValues: { step: outcome.step, note: dto.note },
      });
      return this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    }
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: `LEAVE_${outcome.finalStatus}`,
      resource: 'leave-requests',
      resourceId: id,
      oldValues: { status: 'PENDING' },
      newValues: { status: outcome.finalStatus, note: dto.note },
    });
    void this.slack.leaveDecision(user.tenantId, {
      employeeName,
      type: leave.type,
      from,
      to,
      days: leave.days,
      status: outcome.finalStatus,
      approvedBy: user.name || user.email,
    });
    return this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
  }

  async cancel(user: AuthUser, id: string) {
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    const own = leave.employeeId === user.employeeId;
    const cancellable =
      leave.status === 'PENDING' ||
      (leave.status === 'APPROVED' &&
        user.role === 'ADMIN' &&
        leave.startDate > new Date());
    if ((!own && user.role !== 'ADMIN') || !cancellable)
      throw new ForbiddenException('This request can no longer be cancelled');
    return this.transactions.serializable(async (tx) => {
      const result = await tx.leaveRequest.updateMany({
        where: { id, tenantId: user.tenantId, status: leave.status },
        data: { status: 'CANCELLED' },
      });
      if (!result.count)
        throw new ConflictException(
          'This request changed before it could be cancelled',
        );
      await this.payroll.assertOpen(
        tx,
        user.tenantId,
        leave.employeeId,
        leave.startDate,
        leave.endDate,
      );
      const policy = await this.policies.forDate(
        tx,
        user.tenantId,
        leave.type,
        leave.startDate,
      );
      if (policy?.isPaid) {
        const year = leave.startDate.getUTCFullYear();
        await this.ledger.ensure(
          tx,
          user.tenantId,
          leave.employeeId,
          policy,
          year,
        );
        const event = leave.status === 'PENDING' ? 'RELEASE' : 'REVERSAL';
        await tx.leaveBalanceLedger.create({
          data: {
            tenantId: user.tenantId,
            employeeId: leave.employeeId,
            leaveRequestId: id,
            type: leave.type,
            year,
            event,
            eventKey: `request:${id}:cancel-${leave.status.toLowerCase()}`,
            days: leave.days,
          },
        });
      }
      return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
    });
  }
}

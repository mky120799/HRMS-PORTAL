import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { EmailTemplates } from '../../common/email/templates';
import { PrismaService } from '../../common/prisma/prisma.service';
import { can } from '../../common/auth/permissions';
import type { TenantRole } from '../../common/constants/domain';
import { parseDateOnly } from '../../common/utils/dates';
import { NotificationPublisherService } from '../notifications/notification-publisher.service';
import type {
  ApprovalDelegationDto,
  ReplaceApprovalRulesDto,
} from './dto/create-leave.dto';

export type ApprovalRuleSnapshot = {
  step: number;
  approverKind: 'DIRECT_MANAGER' | 'ROLE' | 'SPECIFIC_USER';
  approverRole?: TenantRole;
  approverUserId?: string;
  reminderAfterHours: number;
  escalationAfterHours?: number;
};

const defaultRule = (): ApprovalRuleSnapshot => ({
  step: 1,
  approverKind: 'DIRECT_MANAGER',
  reminderAfterHours: 24,
});

/** Workflow configuration, delegation, authorization, reminders, and escalation. */
@Injectable()
export class LeaveApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationPublisherService,
  ) {}

  listRules(tenantId: string) {
    return this.prisma.leaveApprovalRule.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ type: 'asc' }, { step: 'asc' }],
    });
  }

  async replaceRules(tenantId: string, dto: ReplaceApprovalRulesDto) {
    const specificUsers = dto.rules
      .filter((rule) => rule.approverKind === 'SPECIFIC_USER')
      .map((rule) => rule.approverUserId!);
    if (specificUsers.length) {
      const users = await this.prisma.user.count({
        where: { tenantId, id: { in: specificUsers }, isActive: true },
      });
      if (users !== new Set(specificUsers).size)
        throw new BadRequestException(
          'Every named approver must be an active user in this tenant',
        );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.leaveApprovalRule.deleteMany({
        where: { tenantId, type: dto.type },
      });
      await tx.leaveApprovalRule.createMany({
        data: dto.rules.map((rule) => ({
          tenantId,
          type: dto.type,
          step: rule.step,
          approverKind: rule.approverKind,
          approverRole: rule.approverKind === 'ROLE' ? rule.approverRole : null,
          approverUserId:
            rule.approverKind === 'SPECIFIC_USER' ? rule.approverUserId : null,
        })),
      });
      return tx.leaveApprovalRule.findMany({
        where: { tenantId, type: dto.type },
        orderBy: { step: 'asc' },
      });
    });
  }

  listDelegations(user: AuthUser) {
    return this.prisma.leaveApprovalDelegation.findMany({
      where: {
        tenantId: user.tenantId,
        OR: [{ delegatorId: user.userId }, { delegateId: user.userId }],
      },
      include: {
        delegator: { select: { id: true, name: true, email: true } },
        delegate: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startsAt: 'desc' },
    });
  }

  async createDelegation(user: AuthUser, dto: ApprovalDelegationDto) {
    if (dto.delegateUserId === user.userId)
      throw new BadRequestException('You cannot delegate approval to yourself');
    const delegate = await this.prisma.user.findFirst({
      where: {
        id: dto.delegateUserId,
        tenantId: user.tenantId,
        isActive: true,
      },
    });
    if (!delegate)
      throw new NotFoundException(
        'Delegate must be an active user in this tenant',
      );
    const delegation = await this.prisma.leaveApprovalDelegation.upsert({
      where: {
        tenantId_delegatorId_delegateId_startsAt: {
          tenantId: user.tenantId,
          delegatorId: user.userId,
          delegateId: dto.delegateUserId,
          startsAt: parseDateOnly(dto.startsAt),
        },
      },
      update: {
        endsAt: dto.endsAt ? parseDateOnly(dto.endsAt) : null,
        isActive: true,
      },
      create: {
        tenantId: user.tenantId,
        delegatorId: user.userId,
        delegateId: dto.delegateUserId,
        startsAt: parseDateOnly(dto.startsAt),
        endsAt: dto.endsAt ? parseDateOnly(dto.endsAt) : null,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'LEAVE_APPROVAL_DELEGATED',
      resource: 'leave-approval-delegations',
      resourceId: delegation.id,
      newValues: {
        delegateUserId: dto.delegateUserId,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
      },
    });
    return delegation;
  }

  async rulesFor(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    type: string,
  ): Promise<ApprovalRuleSnapshot[]> {
    const rules = await db.leaveApprovalRule.findMany({
      where: { tenantId, type, isActive: true },
      orderBy: { step: 'asc' },
    });
    if (!rules.length) return [defaultRule()];
    return rules.map((rule) => ({
      step: rule.step,
      approverKind: rule.approverKind as ApprovalRuleSnapshot['approverKind'],
      ...(rule.approverRole
        ? {
            approverRole:
              rule.approverRole as ApprovalRuleSnapshot['approverRole'],
          }
        : {}),
      ...(rule.approverUserId ? { approverUserId: rule.approverUserId } : {}),
      reminderAfterHours: rule.reminderAfterHours,
      ...(rule.escalationAfterHours
        ? { escalationAfterHours: rule.escalationAfterHours }
        : {}),
    }));
  }

  rulesFromSnapshot(snapshot: Prisma.JsonValue | null): ApprovalRuleSnapshot[] {
    if (!Array.isArray(snapshot) || !snapshot.length) return [defaultRule()];
    const rules = snapshot
      .filter(
        (value): value is Prisma.JsonObject =>
          !!value && typeof value === 'object' && !Array.isArray(value),
      )
      .map((value) => ({
        step: typeof value.step === 'number' ? value.step : 0,
        approverKind: value.approverKind,
        approverRole: value.approverRole,
        approverUserId: value.approverUserId,
        reminderAfterHours:
          typeof value.reminderAfterHours === 'number'
            ? value.reminderAfterHours
            : 24,
        escalationAfterHours:
          typeof value.escalationAfterHours === 'number'
            ? value.escalationAfterHours
            : undefined,
      }));
    if (
      !rules.length ||
      rules.some(
        (rule, index) =>
          rule.step !== index + 1 ||
          !['DIRECT_MANAGER', 'ROLE', 'SPECIFIC_USER'].includes(
            String(rule.approverKind),
          ),
      )
    )
      return [defaultRule()];
    return rules as ApprovalRuleSnapshot[];
  }

  async canApprove(
    db: Prisma.TransactionClient | PrismaService,
    user: AuthUser,
    managerId: string | null,
    managerUserId: string | null,
    rule: ApprovalRuleSnapshot,
  ): Promise<boolean> {
    if (can(user, 'leave.admin')) return true;
    if (rule.approverKind === 'DIRECT_MANAGER') {
      if (!!user.employeeId && user.employeeId === managerId) return true;
      return (
        !!managerUserId &&
        this.isActiveDelegate(db, user.tenantId, managerUserId, user.userId)
      );
    }
    if (rule.approverKind === 'ROLE') return user.role === rule.approverRole;
    if (user.userId === rule.approverUserId) return true;
    return (
      !!rule.approverUserId &&
      this.isActiveDelegate(db, user.tenantId, rule.approverUserId, user.userId)
    );
  }

  async runFollowUps() {
    const requests = await this.prisma.leaveRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        employee: {
          include: {
            manager: {
              include: {
                user: { select: { id: true, email: true, name: true } },
              },
            },
          },
        },
        approvals: { select: { step: true, decision: true, actedAt: true } },
      },
    });
    let queued = 0;
    for (const request of requests) {
      const rules = this.rulesFromSnapshot(request.approvalSnapshot);
      const current = rules.find(
        (rule) =>
          !request.approvals.some(
            (approval) =>
              approval.step === rule.step && approval.decision === 'APPROVED',
          ),
      );
      if (!current) continue;
      const lastAction = request.approvals.reduce(
        (latest, approval) =>
          approval.actedAt > latest ? approval.actedAt : latest,
        request.createdAt,
      );
      const elapsedHours = (Date.now() - lastAction.getTime()) / 3_600_000;
      const kinds: Array<'REMINDER' | 'ESCALATION'> = [];
      if (elapsedHours >= current.reminderAfterHours) kinds.push('REMINDER');
      if (
        current.escalationAfterHours &&
        elapsedHours >= current.escalationAfterHours
      )
        kinds.push('ESCALATION');
      for (const kind of kinds) {
        const recipients = await this.followUpRecipients(
          request.tenantId,
          request.employee.manager?.user?.id ?? null,
          current,
          kind,
        );
        if (!recipients.length) continue;
        const employeeName =
          `${request.employee.firstName} ${request.employee.lastName}`.trim();
        const label = kind === 'REMINDER' ? 'reminder' : 'escalation';
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.leaveApprovalFollowUp.create({
              data: {
                tenantId: request.tenantId,
                leaveRequestId: request.id,
                step: current.step,
                kind,
              },
            });
            await this.notifications.publish(tx, {
              tenantId: request.tenantId,
              eventKey: `leave-approval-${kind.toLowerCase()}:${request.id}:${current.step}`,
              eventType: `LEAVE_APPROVAL_${kind}`,
              category: 'LEAVE',
              data: { leaveRequestId: request.id, step: current.step, kind },
              recipients: recipients.map((recipient) => ({
                userId: recipient.id,
                email: recipient.email,
              })),
              channels: ['IN_APP', 'EMAIL'],
              title: `Leave approval ${label}: ${request.type}`,
              body: `${employeeName} has a pending ${request.type} leave request requiring approval at step ${current.step}.`,
              link: '/leave',
              email: EmailTemplates.leaveApprovalFollowUp({
                recipientName: 'Approver',
                employeeName,
                type: request.type,
                step: current.step,
                kind,
              }),
            });
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          )
            continue;
          throw error;
        }
        queued += recipients.length;
      }
    }
    return { requests: requests.length, queued };
  }

  private async isActiveDelegate(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    delegatorId: string,
    delegateId: string,
  ): Promise<boolean> {
    const today = parseDateOnly(new Date().toISOString().slice(0, 10));
    return !!(await db.leaveApprovalDelegation.count({
      where: {
        tenantId,
        delegatorId,
        delegateId,
        isActive: true,
        startsAt: { lte: today },
        OR: [{ endsAt: null }, { endsAt: { gte: today } }],
      },
    }));
  }

  private followUpRecipients(
    tenantId: string,
    managerUserId: string | null,
    rule: ApprovalRuleSnapshot,
    kind: 'REMINDER' | 'ESCALATION',
  ) {
    if (kind === 'ESCALATION')
      return this.prisma.user.findMany({
        where: { tenantId, role: 'ADMIN', isActive: true },
        select: { id: true, email: true, name: true },
      });
    if (rule.approverKind === 'DIRECT_MANAGER')
      return managerUserId
        ? this.prisma.user.findMany({
            where: { id: managerUserId, tenantId, isActive: true },
            select: { id: true, email: true, name: true },
          })
        : [];
    if (rule.approverKind === 'SPECIFIC_USER')
      return rule.approverUserId
        ? this.prisma.user.findMany({
            where: { id: rule.approverUserId, tenantId, isActive: true },
            select: { id: true, email: true, name: true },
          })
        : [];
    return this.prisma.user.findMany({
      where: { tenantId, role: rule.approverRole, isActive: true },
      select: { id: true, email: true, name: true },
    });
  }
}

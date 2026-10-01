import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseDateOnly } from '../../common/utils/dates';
import { LeaveTransactionService } from './leave-transaction.service';

export type LeavePolicyInput = {
  type: string;
  annualQuota: number;
  isPaid: boolean;
  accrualMode: string;
  carryForwardLimit?: number | null;
  allowNegative: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
};

@Injectable()
export class LeavePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: LeaveTransactionService,
  ) {}

  list(tenantId: string) {
    return this.prisma.leavePolicy.findMany({ where: { tenantId }, orderBy: { type: 'asc' } });
  }

  async listVersions(tenantId: string, type: string) {
    const policy = await this.prisma.leavePolicy.findUnique({ where: { tenantId_type: { tenantId, type } } });
    if (!policy) throw new NotFoundException('Leave policy not found');
    return this.prisma.leavePolicyVersion.findMany({ where: { tenantId, leavePolicyId: policy.id }, orderBy: { version: 'desc' } });
  }

  async upsert(tenantId: string, dto: LeavePolicyInput) {
    const effectiveFrom = dto.effectiveFrom ? parseDateOnly(dto.effectiveFrom) : parseDateOnly(new Date().toISOString().slice(0, 10));
    const effectiveTo = dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null;
    return this.transactions.serializable(async (tx) => {
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

  /** Resolves the immutable entitlement terms that apply on a calendar date. */
  async forDate(db: Prisma.TransactionClient | PrismaService, tenantId: string, type: string, date: Date) {
    const policy = await db.leavePolicy.findUnique({ where: { tenantId_type: { tenantId, type } } });
    if (!policy) return null;
    const version = await db.leavePolicyVersion.findFirst({
      where: { leavePolicyId: policy.id, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
      orderBy: { version: 'desc' },
    });
    if (!version) return policy;
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

  snapshot(policy: { id: string; type: string; annualQuota: number; isPaid: boolean; accrualMode: string; carryForwardLimit: Prisma.Decimal | null; allowNegative: boolean; effectiveFrom: Date; effectiveTo: Date | null }): Prisma.InputJsonValue {
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
}

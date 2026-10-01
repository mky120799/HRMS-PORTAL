import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LeaveLedgerService } from './leave-ledger.service';
import { LeaveTransactionService } from './leave-transaction.service';

/** Distribute an integer annual quota over 12 two-decimal ledger events exactly. */
function monthlyAccrualAmount(annualQuota: number, month: number): number {
  const annualCents = annualQuota * 100;
  const baseCents = Math.floor(annualCents / 12);
  const remainder = annualCents % 12;
  return (baseCents + (month <= remainder ? 1 : 0)) / 100;
}

@Injectable()
export class LeaveAccrualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LeaveLedgerService,
    private readonly transactions: LeaveTransactionService,
  ) {}

  /** Idempotently posts the entitlement for one policy month. */
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
        const created = await this.transactions.serializable(async (tx) => {
          await this.ledger.ensure(tx, tenantId, employee.id, policy, year);
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
        const created = await this.transactions.serializable(async (tx) => {
          await this.ledger.ensure(tx, tenantId, employee.id, policy, fromYear);
          await this.ledger.ensure(tx, tenantId, employee.id, policy, fromYear + 1);
          const available = await this.ledger.availableDays(tx, tenantId, employee.id, policy.type, fromYear);
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
}

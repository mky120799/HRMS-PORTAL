import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const COUNTED = ['PENDING', 'APPROVED'];

export type LedgerPolicy = { type: string; annualQuota: number; isPaid: boolean; accrualMode: string };

/** The single owner of immutable leave-balance ledger initialization and totals. */
@Injectable()
export class LeaveLedgerService {
  async ensure(tx: Prisma.TransactionClient, tenantId: string, employeeId: string, policy: LedgerPolicy, year: number) {
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

  async availableDays(tx: Prisma.TransactionClient, tenantId: string, employeeId: string, type: string, year: number): Promise<number> {
    const total = await tx.leaveBalanceLedger.aggregate({ where: { tenantId, employeeId, type, year }, _sum: { days: true } });
    return Number(total._sum.days ?? 0);
  }
}

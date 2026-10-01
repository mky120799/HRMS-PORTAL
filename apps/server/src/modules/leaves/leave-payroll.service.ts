import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Prevents direct leave edits after an affected payroll period is finalized. */
@Injectable()
export class LeavePayrollService {
  async assertOpen(tx: Prisma.TransactionClient, tenantId: string, employeeId: string, start: Date, end: Date) {
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
}

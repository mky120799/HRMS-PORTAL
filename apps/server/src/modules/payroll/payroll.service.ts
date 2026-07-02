import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  async getMyPayslips(tenantId: string, employeeId: string) {
    return this.prisma.payslip.findMany({
      where: { tenantId, employeeId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async getAllPayslips(tenantId: string) {
    return this.prisma.payslip.findMany({
      where: { tenantId },
      include: { employee: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async generatePayslips(tenantId: string, month: number, year: number) {
    // 1. Get all employees with a salary structure
    const structures = await this.prisma.salaryStructure.findMany({
      where: { tenantId },
      include: { employee: true },
    });

    const payslips = [];

    for (const struct of structures) {
      // Basic flat logic for MVP: Net = Base + Allowances - Deductions (ignoring actual tax logic for now)
      // We will also just mock PF/TDS for demonstration
      const basicPay = struct.baseSalary;
      const allowances = struct.allowances;
      const baseDeductions = struct.deductions;
      
      const tds = basicPay * 0.1; // 10% TDS
      const pf = basicPay * 0.12; // 12% PF

      const totalDeductions = baseDeductions + tds + pf;
      const netPay = (basicPay + allowances) - totalDeductions;

      // Upsert to prevent duplicates
      const payslip = await this.prisma.payslip.upsert({
        where: {
          employeeId_month_year: { employeeId: struct.employeeId, month, year }
        },
        update: {
          basicPay,
          allowances,
          deductions: totalDeductions,
          netPay,
        },
        create: {
          tenantId,
          employeeId: struct.employeeId,
          month,
          year,
          basicPay,
          allowances,
          deductions: totalDeductions,
          netPay,
          pdfUrl: `https://dummy-payslip-url.com/${struct.employeeId}/${year}/${month}.pdf`
        },
      });

      payslips.push(payslip);
    }

    return payslips;
  }
}

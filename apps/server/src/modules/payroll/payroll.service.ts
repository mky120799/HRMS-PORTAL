import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Payslip, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { countWorkingDays, daysInMonth, monthRange, overlap, toDateOnly } from '../../common/utils/dates';
import { calculatePayslip } from './payroll.calculator';
import { renderPayslipPdf } from './payslip-pdf';
import type { UpsertSalaryDto } from './dto/payroll.dto';

const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

function serializePayslip(p: Payslip) {
  return {
    ...p,
    payableDays: n(p.payableDays),
    lopDays: n(p.lopDays),
    basicPay: n(p.basicPay),
    allowances: n(p.allowances),
    grossPay: n(p.grossPay),
    pfDeduction: n(p.pfDeduction),
    tdsDeduction: n(p.tdsDeduction),
    deductions: n(p.deductions),
    netPay: n(p.netPay),
  };
}

/**
 * Payroll lifecycle per month:  (no payslips) → DRAFT → FINALIZED
 *  - generate: (re)computes DRAFT payslips; blocked once the month is finalized.
 *  - finalize: locks the month; payslips become visible to employees and immutable.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Salary structures ──────────────────────────────────────────────────────

  async listSalaries(tenantId: string) {
    const employees = await this.prisma.employee.findMany({
      where: { tenantId, status: { not: 'EXITED' } },
      select: { id: true, firstName: true, lastName: true, department: true, employeeCode: true, salaryStructure: true },
      orderBy: { firstName: 'asc' },
    });
    return employees.map(({ salaryStructure: s, ...e }) => ({
      employee: e,
      salary: s
        ? { baseSalary: n(s.baseSalary), allowances: n(s.allowances), deductions: n(s.deductions), monthlyTds: n(s.monthlyTds), pfEnabled: s.pfEnabled, updatedAt: s.updatedAt }
        : null,
    }));
  }

  async upsertSalary(user: AuthUser, employeeId: string, dto: UpsertSalaryDto) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId: user.tenantId, status: { not: 'EXITED' } } });
    if (!employee) throw new NotFoundException('Employee not found');
    const before = await this.prisma.salaryStructure.findUnique({ where: { employeeId } });
    const saved = await this.prisma.salaryStructure.upsert({
      where: { employeeId },
      update: dto,
      create: { ...dto, tenantId: user.tenantId, employeeId },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: before ? 'SALARY_UPDATED' : 'SALARY_CREATED',
      resource: 'payroll',
      resourceId: employeeId,
      oldValues: before ? { baseSalary: n(before.baseSalary), allowances: n(before.allowances), deductions: n(before.deductions), monthlyTds: n(before.monthlyTds), pfEnabled: before.pfEnabled } : null,
      newValues: dto,
    });
    return { ...saved, baseSalary: n(saved.baseSalary), allowances: n(saved.allowances), deductions: n(saved.deductions), monthlyTds: n(saved.monthlyTds) };
  }

  // ─── Payroll runs ───────────────────────────────────────────────────────────

  async generate(user: AuthUser, year: number, month: number) {
    const { start, end } = monthRange(year, month);
    if (start > new Date()) throw new BadRequestException('Cannot run payroll for a future month');
    const finalized = await this.prisma.payslip.count({ where: { tenantId: user.tenantId, year, month, status: 'FINALIZED' } });
    if (finalized) throw new ConflictException('Payroll for this month is already finalized');

    const calendarDays = daysInMonth(year, month);
    const [structures, unpaidTypes, holidays] = await Promise.all([
      this.prisma.salaryStructure.findMany({
        where: {
          tenantId: user.tenantId,
          employee: {
            OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: end } }],
            AND: [{ OR: [{ exitDate: null }, { exitDate: { gte: start } }] }],
          },
        },
        include: { employee: { select: { id: true, firstName: true, lastName: true, dateOfJoining: true, exitDate: true } } },
      }),
      this.prisma.leavePolicy.findMany({ where: { tenantId: user.tenantId, isPaid: false }, select: { type: true } }),
      this.prisma.holiday.findMany({ where: { tenantId: user.tenantId, date: { gte: start, lte: end } }, select: { date: true } }),
    ]);
    const holidaySet = new Set(holidays.map((h) => toDateOnly(h.date)));
    const unpaidLeaves = await this.prisma.leaveRequest.findMany({
      where: { tenantId: user.tenantId, status: 'APPROVED', type: { in: unpaidTypes.map((t) => t.type) }, startDate: { lte: end }, endDate: { gte: start } },
      select: { employeeId: true, startDate: true, endDate: true },
    });

    const warnings: { employeeId: string; name: string; message: string }[] = [];
    const payslips = [];
    for (const s of structures) {
      const e = s.employee;
      // Loss of pay: approved unpaid leave (working days) + calendar days outside employment.
      let lop = unpaidLeaves
        .filter((l) => l.employeeId === e.id)
        .reduce((sum, l) => {
          const o = overlap(l.startDate, l.endDate, start, end);
          return sum + (o ? countWorkingDays(o.start, o.end, holidaySet) : 0);
        }, 0);
      if (e.dateOfJoining && e.dateOfJoining > start) lop += Math.round((e.dateOfJoining.getTime() - start.getTime()) / 86_400_000);
      if (e.exitDate && e.exitDate < end) lop += Math.round((end.getTime() - e.exitDate.getTime()) / 86_400_000);

      const f = calculatePayslip(
        { baseSalary: n(s.baseSalary), allowances: n(s.allowances), deductions: n(s.deductions), monthlyTds: n(s.monthlyTds), pfEnabled: s.pfEnabled },
        calendarDays,
        lop,
      );
      f.warnings.forEach((message) => warnings.push({ employeeId: e.id, name: `${e.firstName} ${e.lastName}`, message }));

      const data = {
        payableDays: f.payableDays, lopDays: f.lopDays, basicPay: f.basicPay, allowances: f.allowances, grossPay: f.grossPay,
        pfDeduction: f.pfDeduction, tdsDeduction: f.tdsDeduction, deductions: f.deductions, netPay: f.netPay, status: 'DRAFT',
      };
      payslips.push(
        await this.prisma.payslip.upsert({
          where: { employeeId_month_year: { employeeId: e.id, month, year } },
          update: data,
          create: { ...data, tenantId: user.tenantId, employeeId: e.id, month, year },
        }),
      );
    }

    const withoutSalary = await this.prisma.employee.count({ where: { tenantId: user.tenantId, status: { not: 'EXITED' }, salaryStructure: null } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'PAYROLL_GENERATED', resource: 'payroll', newValues: { year, month, count: payslips.length } });
    return { year, month, status: 'DRAFT', count: payslips.length, employeesWithoutSalary: withoutSalary, warnings, payslips: payslips.map(serializePayslip) };
  }

  async getRun(tenantId: string, year: number, month: number) {
    const payslips = await this.prisma.payslip.findMany({
      where: { tenantId, year, month },
      include: { employee: { select: { id: true, firstName: true, lastName: true, department: true, employeeCode: true } } },
      orderBy: { employee: { firstName: 'asc' } },
    });
    const totals = payslips.reduce(
      (t, p) => ({ gross: t.gross + n(p.grossPay), deductions: t.deductions + n(p.deductions), net: t.net + n(p.netPay) }),
      { gross: 0, deductions: 0, net: 0 },
    );
    const round = (v: number) => Math.round(v * 100) / 100;
    return {
      year,
      month,
      status: payslips.length === 0 ? 'NOT_STARTED' : payslips.every((p) => p.status === 'FINALIZED') ? 'FINALIZED' : 'DRAFT',
      totals: { gross: round(totals.gross), deductions: round(totals.deductions), net: round(totals.net) },
      payslips: payslips.map((p) => ({ ...serializePayslip(p), employee: p.employee })),
    };
  }

  async finalize(user: AuthUser, year: number, month: number) {
    const result = await this.prisma.payslip.updateMany({
      where: { tenantId: user.tenantId, year, month, status: 'DRAFT' },
      data: { status: 'FINALIZED', finalizedAt: new Date() },
    });
    if (result.count === 0) throw new BadRequestException('There are no draft payslips to finalize for this month');
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'PAYROLL_FINALIZED', resource: 'payroll', newValues: { year, month, count: result.count } });
    return { year, month, finalized: result.count };
  }

  // ─── Employee self-service ──────────────────────────────────────────────────

  async myPayslips(user: AuthUser) {
    if (!user.employeeId) return [];
    const payslips = await this.prisma.payslip.findMany({
      where: { tenantId: user.tenantId, employeeId: user.employeeId, status: 'FINALIZED' },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return payslips.map(serializePayslip);
  }

  /** Employees may download their own finalized payslips; admins may download any in their tenant. */
  async payslipPdf(user: AuthUser, id: string) {
    const p = await this.prisma.payslip.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { employee: true, tenant: { select: { name: true } } },
    });
    if (!p) throw new NotFoundException('Payslip not found');
    const own = p.employeeId === user.employeeId;
    if (!(user.role === 'ADMIN' || (own && p.status === 'FINALIZED'))) throw new ForbiddenException('You cannot access this payslip');

    const pdf = await renderPayslipPdf({
      companyName: p.tenant.name,
      employeeName: `${p.employee.firstName} ${p.employee.lastName}`.trim(),
      employeeCode: p.employee.employeeCode,
      department: p.employee.department,
      designation: p.employee.designation,
      month: p.month,
      year: p.year,
      payableDays: n(p.payableDays),
      lopDays: n(p.lopDays),
      basicPay: n(p.basicPay),
      allowances: n(p.allowances),
      grossPay: n(p.grossPay),
      pfDeduction: n(p.pfDeduction),
      tdsDeduction: n(p.tdsDeduction),
      otherDeductions: Math.round((n(p.deductions) - n(p.pfDeduction) - n(p.tdsDeduction)) * 100) / 100,
      deductions: n(p.deductions),
      netPay: n(p.netPay),
    });
    return { pdf, filename: `payslip-${p.year}-${String(p.month).padStart(2, '0')}.pdf` };
  }
}

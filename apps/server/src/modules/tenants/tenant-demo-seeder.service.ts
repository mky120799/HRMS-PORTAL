import { ConflictException, Injectable } from '@nestjs/common';
import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { calculatePayslip } from '../payroll/payroll.calculator';
import { countWorkingDays, daysInMonth, parseDateOnly, toDateOnly } from '../../common/utils/dates';

const DEPARTMENTS = ['Engineering', 'People', 'Sales', 'Marketing', 'Finance'];
const JOBS = [
  { title: 'Senior Software Engineer', department: 'Engineering', description: 'Design and build scalable backend services, review code and mentor engineers.' },
  { title: 'HR Business Partner', department: 'People', description: 'Partner with leadership on talent strategy, performance and employee development.' },
  { title: 'Account Executive', department: 'Sales', description: 'Own the full sales cycle for mid-market accounts and close new business.' },
];

/**
 * Seeds a brand-new workspace with realistic sample data so a trial user can
 * explore every screen. Guard rails:
 *  - only once per tenant, and only while the workspace is still empty
 *    (never mixes fake records into a real company's data);
 *  - never touches subscription/billing fields;
 *  - all inserts run in one transaction — it either fully succeeds or leaves nothing.
 */
@Injectable()
export class TenantDemoSeederService {
  constructor(private readonly prisma: PrismaService) {}

  async seed(tenantId: string): Promise<void> {
    const [tenant, employeeCount] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { demoSeededAt: true } }),
      this.prisma.employee.count({ where: { tenantId } }),
    ]);
    if (tenant.demoSeededAt || employeeCount > 1) {
      throw new ConflictException('Sample data can only be added to a new, empty workspace.');
    }

    const today = new Date();
    const employees: { id: string; department: string; managerId: string | null; tenantId: string; email: string; firstName: string; lastName: string; designation: string; employeeCode: string; dateOfJoining: Date }[] = [];
    let code = 1;
    for (const department of DEPARTMENTS) {
      let managerId: string | null = null;
      for (let i = 0; i < 4; i++) {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const id = randomUUID();
        employees.push({
          id,
          tenantId,
          department,
          managerId,
          firstName,
          lastName,
          email: faker.internet.email({ firstName, lastName, provider: 'example.com' }).toLowerCase(),
          designation: i === 0 ? `${department} Manager` : faker.person.jobTitle(),
          employeeCode: `DEMO-${String(code++).padStart(3, '0')}`,
          dateOfJoining: faker.date.past({ years: 4 }),
        });
        if (i === 0) managerId = id;
      }
    }

    const salaries = employees.map((e) => ({
      id: randomUUID(),
      tenantId,
      employeeId: e.id,
      baseSalary: faker.number.int({ min: 25, max: 90 }) * 1000,
      allowances: faker.number.int({ min: 5, max: 20 }) * 1000,
      deductions: 200,
      monthlyTds: faker.number.int({ min: 0, max: 8 }) * 1000,
      pfEnabled: true,
    }));

    const attendance: any[] = [];
    for (let back = 30; back >= 1; back--) {
      const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back));
      if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
      for (const e of employees) {
        if (Math.random() < 0.08) continue;
        const clockIn = new Date(day.getTime() + faker.number.int({ min: 3 * 60, max: 5 * 60 }) * 60_000);
        const workMinutes = faker.number.int({ min: 7 * 60, max: 9 * 60 + 30 });
        attendance.push({ tenantId, employeeId: e.id, date: day, clockIn, clockOut: new Date(clockIn.getTime() + workMinutes * 60_000), workMinutes, status: 'PRESENT' });
      }
    }

    const payslips: any[] = [];
    for (let offset = 3; offset >= 1; offset--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1));
      const [year, month] = [d.getUTCFullYear(), d.getUTCMonth() + 1];
      for (const s of salaries) {
        const f = calculatePayslip({ ...s }, daysInMonth(year, month), 0);
        payslips.push({
          tenantId, employeeId: s.employeeId, month, year, status: 'FINALIZED', finalizedAt: new Date(Date.UTC(year, month, 1)),
          payableDays: f.payableDays, lopDays: f.lopDays, basicPay: f.basicPay, allowances: f.allowances, grossPay: f.grossPay,
          pfDeduction: f.pfDeduction, tdsDeduction: f.tdsDeduction, deductions: f.deductions, netPay: f.netPay,
        });
      }
    }

    const leaves: any[] = [];
    for (let offset = 5; offset >= 0; offset--) {
      for (const e of faker.helpers.arrayElements(employees, 3)) {
        const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, faker.number.int({ min: 1, max: 20 })));
        const end = new Date(start.getTime() + faker.number.int({ min: 0, max: 3 }) * 86_400_000);
        const status = offset === 0 ? 'PENDING' : faker.helpers.arrayElement(['APPROVED', 'APPROVED', 'APPROVED', 'REJECTED']);
        leaves.push({
          tenantId, employeeId: e.id, type: faker.helpers.arrayElement(['ANNUAL', 'SICK', 'CASUAL']),
          startDate: parseDateOnly(toDateOnly(start)), endDate: parseDateOnly(toDateOnly(end)), days: Math.max(1, countWorkingDays(start, end)),
          reason: faker.helpers.arrayElement(['Family function', 'Medical appointment', 'Personal travel', 'Vacation']),
          status, reviewedAt: status === 'PENDING' ? null : end, createdAt: start,
        });
      }
    }

    const jobs = JOBS.map((j) => ({ ...j, id: randomUUID(), tenantId, status: 'OPEN', location: 'Remote' }));
    const applications = jobs.flatMap((j) =>
      Array.from({ length: 4 }, () => ({
        tenantId, jobId: j.id, candidateName: faker.person.fullName(), candidateEmail: faker.internet.email({ provider: 'example.com' }).toLowerCase(),
        status: faker.helpers.arrayElement(['APPLIED', 'SCREENING', 'INTERVIEW', 'REJECTED']),
      })),
    );

    const reviews = employees
      .filter((e) => e.managerId)
      .slice(0, 8)
      .map((e) => ({
        tenantId, employeeId: e.id, reviewerId: e.managerId, cycleName: `H1 ${today.getUTCFullYear()}`,
        selfRating: faker.number.int({ min: 3, max: 5 }), managerRating: faker.number.int({ min: 2, max: 5 }),
        selfComments: 'Delivered my goals for the half and supported the team.', managerComments: 'Solid half. Keep growing ownership of larger projects.',
        status: 'COMPLETED', submittedAt: today, completedAt: today,
      }));

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.createMany({ data: employees.filter((e) => !e.managerId) });
      await tx.employee.createMany({ data: employees.filter((e) => e.managerId) });
      await tx.salaryStructure.createMany({ data: salaries });
      await tx.attendanceRecord.createMany({ data: attendance, skipDuplicates: true });
      await tx.payslip.createMany({ data: payslips, skipDuplicates: true });
      await tx.leaveRequest.createMany({ data: leaves });
      await tx.job.createMany({ data: jobs });
      await tx.application.createMany({ data: applications, skipDuplicates: true });
      await tx.performanceReview.createMany({ data: reviews, skipDuplicates: true });
      await tx.tenant.update({ where: { id: tenantId }, data: { demoSeededAt: new Date() } });
    }, { timeout: 30_000 });
  }
}

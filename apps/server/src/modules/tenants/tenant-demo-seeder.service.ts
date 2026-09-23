import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { faker } from '@faker-js/faker';

const DEPARTMENTS = ['Engineering', 'HR', 'Sales', 'Marketing', 'Finance'];

const JOB_OPENINGS = [
  {
    title: 'Senior Software Engineer',
    description: 'We are looking for an experienced software engineer to join our engineering team. You will design and build scalable backend services and mentor junior engineers.',
    department: 'Engineering',
  },
  {
    title: 'HR Business Partner',
    description: 'We are seeking an HR Business Partner to drive talent strategy, partner with leadership, and support employee development across the organization.',
    department: 'HR',
  },
  {
    title: 'Account Executive',
    description: 'Join our growing sales team to drive new business development, manage enterprise accounts, and close high-value contracts.',
    department: 'Sales',
  },
];

@Injectable()
export class TenantDemoSeederService {
  constructor(private prisma: PrismaService) {}

  async seed(tenantId: string): Promise<void> {
    // Idempotency guard: do not re-seed if employees already exist
    const existingCount = await this.prisma.employee.count({ where: { tenantId } });
    if (existingCount > 3) {
      throw new ConflictException('Demo data has already been seeded for this workspace.');
    }

    // 1. Upgrade tenant to BUSINESS / ACTIVE
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { subscriptionPlan: 'BUSINESS', subscriptionStatus: 'ACTIVE', trialEndsAt: null },
    });

    // 2. Create 20 employees (4 per department)
    const employees: any[] = [];
    for (const dept of DEPARTMENTS) {
      for (let i = 0; i < 4; i++) {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const email = faker.internet.email({ firstName, lastName, provider: 'demo.hrms' }).toLowerCase();
        const emp = await this.prisma.employee.create({
          data: { tenantId, email, firstName, lastName, department: dept },
        });
        employees.push(emp);
      }
    }

    // 3. Salary structures
    const salaryRanges: Record<string, [number, number]> = {
      Engineering: [75000, 140000], Finance: [65000, 110000],
      HR: [55000, 90000], Sales: [50000, 95000], Marketing: [55000, 95000],
    };
    for (const emp of employees) {
      const [min, max] = salaryRanges[emp.department!] ?? [40000, 80000];
      await this.prisma.salaryStructure.create({
        data: {
          tenantId, employeeId: emp.id,
          baseSalary: faker.number.int({ min, max }),
          allowances: faker.number.int({ min: 2000, max: 8000 }),
          deductions: faker.number.int({ min: 500, max: 3000 }),
        },
      });
    }

    // 4. Attendance records — 30 working days
    const today = new Date();
    const attendanceData: any[] = [];
    for (let day = 30; day >= 1; day--) {
      const date = new Date(today);
      date.setDate(date.getDate() - day);
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      for (const emp of employees) {
        if (Math.random() < 0.10) continue;
        const clockIn = new Date(dateOnly);
        clockIn.setHours(faker.number.int({ min: 8, max: 10 }), faker.number.int({ min: 0, max: 59 }));
        const clockOut = new Date(dateOnly);
        clockOut.setHours(faker.number.int({ min: 17, max: 19 }), faker.number.int({ min: 0, max: 59 }));
        attendanceData.push({ tenantId, employeeId: emp.id, date: dateOnly, clockIn, clockOut, status: 'PRESENT' });
      }
    }
    await this.prisma.attendanceRecord.createMany({ data: attendanceData, skipDuplicates: true });

    // 5. Payslips — 3 months
    const salaryStructures = await this.prisma.salaryStructure.findMany({ where: { tenantId } });
    const salaryMap: Record<string, number> = {};
    for (const s of salaryStructures) salaryMap[s.employeeId] = s.baseSalary;
    const payslipData: any[] = [];
    for (let monthOffset = 3; monthOffset >= 1; monthOffset--) {
      const d = new Date(today.getFullYear(), today.getMonth() - monthOffset, 1);
      const month = d.getMonth() + 1;
      const year = d.getFullYear();
      for (const emp of employees) {
        const basicPay = (salaryMap[emp.id] ?? 60000) / 12;
        const allowances = faker.number.int({ min: 2000, max: 8000 });
        const deductions = faker.number.int({ min: 500, max: 3000 });
        payslipData.push({
          tenantId, employeeId: emp.id, month, year,
          basicPay: Math.round(basicPay), allowances, deductions,
          netPay: Math.round(basicPay + allowances - deductions), status: 'PAID',
        });
      }
    }
    await this.prisma.payslip.createMany({ data: payslipData, skipDuplicates: true });

    // 6. Leave requests — 6 months of data
    const leaveTypes = ['ANNUAL', 'SICK', 'CASUAL'];
    const leaveStatuses = ['APPROVED', 'APPROVED', 'APPROVED', 'PENDING', 'REJECTED'];
    const leaveData: any[] = [];
    for (let monthOffset = 6; monthOffset >= 1; monthOffset--) {
      const monthStart = new Date(today.getFullYear(), today.getMonth() - monthOffset, 1);
      const shuffled = [...employees].sort(() => Math.random() - 0.5).slice(0, 3);
      for (const emp of shuffled) {
        const startDate = new Date(monthStart);
        startDate.setDate(faker.number.int({ min: 1, max: 20 }));
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + faker.number.int({ min: 1, max: 4 }));
        leaveData.push({
          tenantId, employeeId: emp.id,
          type: faker.helpers.arrayElement(leaveTypes),
          startDate, endDate,
          reason: faker.helpers.arrayElement(['Family function', 'Medical appointment', 'Personal travel', 'Annual vacation', 'Unwell']),
          status: faker.helpers.arrayElement(leaveStatuses),
          createdAt: new Date(monthStart.getTime() + 5 * 24 * 60 * 60 * 1000),
        });
      }
    }
    await this.prisma.leaveRequest.createMany({ data: leaveData });

    // 7. Job postings + applications
    const candidateStatuses = ['APPLIED', 'APPLIED', 'INTERVIEW', 'HIRED', 'REJECTED'];
    for (const jobDef of JOB_OPENINGS) {
      const job = await this.prisma.job.create({ data: { tenantId, ...jobDef, status: 'OPEN' } });
      for (let i = 0; i < 4; i++) {
        await this.prisma.application.create({
          data: {
            jobId: job.id,
            candidateName: faker.person.fullName(),
            candidateEmail: faker.internet.email().toLowerCase(),
            status: faker.helpers.arrayElement(candidateStatuses),
            aiScore: faker.number.int({ min: 45, max: 98 }),
            aiReason: faker.helpers.arrayElement([
              'Strong technical background with relevant experience.',
              'Good cultural fit, lacks some required skills.',
              'Excellent leadership experience, strong candidate.',
              'Meets all requirements, highly recommended.',
              'Partial match — missing required experience.',
            ]),
          },
        });
      }
    }

    // 8. Performance reviews — Q1 and Q2 for 5 employees
    const reviewers = employees.slice(0, 2);
    const reviewees = employees.slice(2, 7);
    for (const cycle of ['Q1 2026', 'Q2 2026']) {
      for (const emp of reviewees) {
        await this.prisma.performanceReview.create({
          data: {
            tenantId, employeeId: emp.id,
            reviewerId: faker.helpers.arrayElement(reviewers).id,
            cycleName: cycle,
            selfRating: faker.number.int({ min: 3, max: 5 }),
            managerRating: faker.number.int({ min: 2, max: 5 }),
            comments: faker.helpers.arrayElement([
              'Consistently meets expectations. Strong teamwork.',
              'Exceeded targets this quarter. Demonstrated excellent initiative.',
              'Good performance overall. Areas to improve: time management.',
              'Outstanding contributor. Promoted to senior role this cycle.',
              'Meets expectations. Recommended for a development plan.',
            ]),
            status: 'COMPLETED',
          },
        });
      }
    }

    // 9. Documents — 3 docs for 5 employees
    const docTypes = [
      { title: 'Offer Letter', type: 'CONTRACT' },
      { title: 'Non-Disclosure Agreement', type: 'CONTRACT' },
      { title: 'Government ID Proof', type: 'ID' },
    ];
    for (const emp of employees.slice(0, 5)) {
      for (const doc of docTypes) {
        await this.prisma.document.create({
          data: {
            tenantId, employeeId: emp.id,
            title: doc.title, type: doc.type,
            fileUrl: `https://storage.demo.hrms/docs/${emp.id}/${doc.type.toLowerCase()}.pdf`,
            expiryDate: doc.type === 'ID' ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * faker.number.int({ min: 1, max: 5 })) : null,
          },
        });
      }
    }
  }
}

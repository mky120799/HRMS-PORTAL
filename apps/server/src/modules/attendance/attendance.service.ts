import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/auth/auth-user';
import type { TenantSnapshot } from '../../common/tenant/tenant-context.service';
import { parseDateOnly, todayIn, toDateOnly } from '../../common/utils/dates';

const HALF_DAY_MINUTES = 4 * 60;

/**
 * Self-service clock-in/out. "Today" is the calendar date in the *tenant's*
 * timezone, so an employee in India clocking in at 00:30 IST is recorded on
 * the right day even though the server runs in UTC.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  private employeeIdOf(user: AuthUser): string {
    if (!user.employeeId) throw new BadRequestException('Your account is not linked to an employee profile');
    return user.employeeId;
  }

  async clockIn(user: AuthUser, tenant: TenantSnapshot) {
    const employeeId = this.employeeIdOf(user);
    const date = parseDateOnly(todayIn(tenant.timezone));
    try {
      // Unique (employeeId, date) makes double clock-in impossible even under concurrent requests.
      return await this.prisma.attendanceRecord.create({
        data: { tenantId: user.tenantId, employeeId, date, clockIn: new Date(), status: 'PRESENT' },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You have already clocked in today');
      throw e;
    }
  }

  async clockOut(user: AuthUser, tenant: TenantSnapshot) {
    const employeeId = this.employeeIdOf(user);
    const date = parseDateOnly(todayIn(tenant.timezone));
    const record = await this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } } });
    if (!record || record.tenantId !== user.tenantId) throw new BadRequestException('You have not clocked in today');
    if (record.clockOut) throw new ConflictException('You have already clocked out today');

    const clockOut = new Date();
    const workMinutes = Math.round((clockOut.getTime() - record.clockIn.getTime()) / 60_000);
    return this.prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { clockOut, workMinutes, status: workMinutes < HALF_DAY_MINUTES ? 'HALF_DAY' : 'PRESENT' },
    });
  }

  async mine(user: AuthUser, tenant: TenantSnapshot, from?: string, to?: string) {
    const employeeId = this.employeeIdOf(user);
    const end = parseDateOnly(to ?? todayIn(tenant.timezone));
    const start = from ? parseDateOnly(from) : new Date(end.getTime() - 30 * 86_400_000);
    this.assertRange(start, end);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { tenantId: user.tenantId, employeeId, date: { gte: start, lte: end } },
      orderBy: { date: 'desc' },
    });
    const today = records.find((r) => toDateOnly(r.date) === todayIn(tenant.timezone)) ?? null;
    return { today, records };
  }

  /** Daily roster: every active employee in scope with their record for the date (or absent). */
  async roster(user: AuthUser, tenant: TenantSnapshot, date?: string) {
    const day = parseDateOnly(date ?? todayIn(tenant.timezone));
    let scope: Prisma.EmployeeWhereInput = {};
    if (user.role === 'MANAGER') {
      if (!user.employeeId) throw new ForbiddenException();
      scope = { managerId: user.employeeId };
    } else if (user.role !== 'ADMIN') {
      throw new ForbiddenException();
    }
    const employees = await this.prisma.employee.findMany({
      where: { tenantId: user.tenantId, status: { not: 'EXITED' }, ...scope },
      select: { id: true, firstName: true, lastName: true, department: true, attendance: { where: { date: day } } },
      orderBy: { firstName: 'asc' },
    });
    const rows = employees.map(({ attendance, ...e }) => ({ employee: e, record: attendance[0] ?? null, status: attendance[0]?.status ?? 'ABSENT' }));
    return {
      date: toDateOnly(day),
      summary: {
        total: rows.length,
        present: rows.filter((r) => r.status === 'PRESENT').length,
        halfDay: rows.filter((r) => r.status === 'HALF_DAY').length,
        absent: rows.filter((r) => r.status === 'ABSENT').length,
      },
      rows,
    };
  }

  private assertRange(start: Date, end: Date) {
    if (start > end) throw new BadRequestException('`from` must be before `to`');
    if (end.getTime() - start.getTime() > 366 * 86_400_000) throw new BadRequestException('Range cannot exceed one year');
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/auth/auth-user';
import type { TenantSnapshot } from '../../common/tenant/tenant-context.service';
import { EmailTemplates } from '../../common/email/templates';
import { parseDateOnly, todayIn, toDateOnly } from '../../common/utils/dates';
import { NotificationPublisherService } from '../notifications/notification-publisher.service';
import { can } from '../../common/auth/permissions';

const HALF_DAY_MINUTES = 4 * 60;

/**
 * Self-service clock-in/out. "Today" is the calendar date in the *tenant's*
 * timezone, so an employee in India clocking in at 00:30 IST is recorded on
 * the right day even though the server runs in UTC.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationPublisherService,
    private readonly config: ConfigService,
  ) {}

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
    const status = workMinutes < HALF_DAY_MINUTES ? 'HALF_DAY' : 'PRESENT';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceRecord.update({
        where: { id: record.id },
        data: { clockOut, workMinutes, status },
      });
      if (status === 'HALF_DAY') {
        const employee = await tx.employee.findUniqueOrThrow({
          where: { id: employeeId },
          select: {
            firstName: true,
            lastName: true,
            email: true,
            userId: true,
          },
        });
        const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
        const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:5173');
        await this.notifications.publish(tx, {
          tenantId: user.tenantId,
          eventKey: `attendance-half-day:${record.id}`,
          eventType: 'ATTENDANCE_HALF_DAY',
          category: 'ATTENDANCE',
          data: { attendanceRecordId: record.id, date: toDateOnly(date), workMinutes },
          recipients: [{ userId: employee.userId, email: employee.email }],
          channels: ['IN_APP', 'EMAIL'],
          title: 'Attendance marked half-day',
          body: `Your attendance for ${toDateOnly(date)} was marked half-day.`,
          link: '/attendance',
          email: EmailTemplates.attendanceReminder({
            name: employeeName,
            date: toDateOnly(date),
            kind: 'HALF_DAY',
            link: `${frontendUrl}/attendance`,
          }),
        });
      }
      return updated;
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
    } else if (!can(user, 'attendance.roster.read')) {
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

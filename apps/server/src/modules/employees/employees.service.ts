import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginate, paged } from '../../common/validation/common.schemas';
import { parseDateOnly } from '../../common/utils/dates';
import type { CreateEmployeeDto, ListEmployeesQuery, UpdateEmployeeDto } from './dto/create-employee.dto';

/** What every colleague may see (company directory). */
const DIRECTORY_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  department: true,
  designation: true,
  managerId: true,
  status: true,
} satisfies Prisma.EmployeeSelect;

/** What HR/admins and the person's own managers see. */
const FULL_FIELDS = {
  ...DIRECTORY_FIELDS,
  employeeCode: true,
  phone: true,
  employmentType: true,
  dateOfJoining: true,
  exitDate: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  manager: { select: { id: true, firstName: true, lastName: true } },
  user: { select: { role: true, isActive: true } },
} satisfies Prisma.EmployeeSelect;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: ListEmployeesQuery) {
    const where: Prisma.EmployeeWhereInput = {
      tenantId: user.tenantId,
      anonymizedAt: null,
      ...(q.department ? { department: q.department } : {}),
      ...(q.status ? { status: q.status } : user.role === 'ADMIN' ? {} : { status: { not: 'EXITED' } }),
      ...(q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' } },
              { lastName: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              { employeeCode: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const select = user.role === 'ADMIN' ? FULL_FIELDS : DIRECTORY_FIELDS;
    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({ where, select, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], ...paginate(q) }),
      this.prisma.employee.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async me(user: AuthUser) {
    if (!user.employeeId) throw new NotFoundException('Your account is not linked to an employee profile');
    return this.prisma.employee.findFirstOrThrow({ where: { id: user.employeeId, tenantId: user.tenantId }, select: FULL_FIELDS });
  }

  async findOne(user: AuthUser, id: string) {
    const canSeeFull = user.role === 'ADMIN' || user.employeeId === id || (await this.isManagerOf(user, id));
    const employee = await this.prisma.employee.findFirst({
      where: { id, tenantId: user.tenantId },
      select: canSeeFull ? FULL_FIELDS : DIRECTORY_FIELDS,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  /** True when `user` is the direct manager of employee `employeeId`. */
  async isManagerOf(user: AuthUser, employeeId: string): Promise<boolean> {
    if (!user.employeeId) return false;
    const count = await this.prisma.employee.count({ where: { id: employeeId, tenantId: user.tenantId, managerId: user.employeeId } });
    return count > 0;
  }

  async create(user: AuthUser, dto: CreateEmployeeDto) {
    if (dto.managerId) await this.assertInTenant(user.tenantId, dto.managerId);
    const employee = await this.prisma.employee.create({
      data: {
        ...dto,
        tenantId: user.tenantId,
        managerId: dto.managerId ?? null,
        dateOfJoining: dto.dateOfJoining ? parseDateOnly(dto.dateOfJoining) : null,
      },
      select: FULL_FIELDS,
    });
    return employee;
  }

  async update(user: AuthUser, id: string, dto: UpdateEmployeeDto) {
    const existing = await this.prisma.employee.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw new NotFoundException('Employee not found');
    if (existing.status === 'EXITED') throw new BadRequestException('Exited employees cannot be edited');
    if (dto.managerId) await this.assertValidManager(user.tenantId, id, dto.managerId);

    const updated = await this.prisma.employee.update({
      where: { id },
      data: { ...dto, dateOfJoining: dto.dateOfJoining ? parseDateOnly(dto.dateOfJoining) : undefined },
      select: FULL_FIELDS,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'EMPLOYEE_UPDATED',
      resource: 'employees',
      resourceId: id,
      oldValues: Object.fromEntries(Object.keys(dto).map((k) => [k, (existing as any)[k]])),
      newValues: dto,
    });
    return updated;
  }

  /**
   * Offboarding: marks the employee EXITED, detaches their reports, disables
   * their login and revokes every session immediately (tokenVersion bump).
   */
  async offboard(user: AuthUser, id: string, exitDate: string) {
    if (id === user.employeeId) throw new BadRequestException('You cannot offboard yourself');
    const employee = await this.prisma.employee.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status === 'EXITED') throw new BadRequestException('Employee has already exited');

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { status: 'EXITED', exitDate: parseDateOnly(exitDate) } });
      await tx.employee.updateMany({ where: { tenantId: user.tenantId, managerId: id }, data: { managerId: employee.managerId } });
      await tx.leaveRequest.updateMany({ where: { tenantId: user.tenantId, employeeId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      if (employee.userId) {
        await tx.user.update({
          where: { id: employee.userId },
          data: { isActive: false, tokenVersion: { increment: 1 }, refreshToken: null, refreshTokenExpiry: null },
        });
      }
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'EMPLOYEE_OFFBOARDED', resource: 'employees', resourceId: id, newValues: { exitDate } });
    return { message: 'Employee offboarded and access revoked' };
  }

  async changeRole(user: AuthUser, employeeId: string, role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE') {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId: user.tenantId }, include: { user: true } });
    if (!employee?.user) throw new NotFoundException('This employee has no user account yet — invite them first');
    if (employee.user.id === user.userId) throw new ForbiddenException('You cannot change your own role');
    if (employee.user.role === 'ADMIN' && role !== 'ADMIN') {
      const admins = await this.prisma.user.count({ where: { tenantId: user.tenantId, role: 'ADMIN', isActive: true } });
      if (admins <= 1) throw new BadRequestException('A workspace must keep at least one active admin');
    }
    // Revoke sessions so the new role takes effect on the next refresh rather than lingering for 7 days.
    await this.prisma.user.update({
      where: { id: employee.user.id },
      data: { role, tokenVersion: { increment: 1 }, refreshToken: null, refreshTokenExpiry: null },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'ROLE_CHANGED',
      resource: 'users',
      resourceId: employee.user.id,
      oldValues: { role: employee.user.role },
      newValues: { role },
    });
    return { message: `Role updated to ${role}` };
  }

  private async assertInTenant(tenantId: string, employeeId: string) {
    const found = await this.prisma.employee.count({ where: { id: employeeId, tenantId, status: { not: 'EXITED' } } });
    if (!found) throw new BadRequestException('Manager must be an active employee of this workspace');
  }

  /** Rejects self-management and reporting cycles (A → B → A). */
  private async assertValidManager(tenantId: string, employeeId: string, managerId: string) {
    if (employeeId === managerId) throw new BadRequestException('An employee cannot report to themselves');
    await this.assertInTenant(tenantId, managerId);
    let cursor: string | null = managerId;
    for (let depth = 0; cursor && depth < 50; depth++) {
      if (cursor === employeeId) throw new BadRequestException('This change would create a reporting cycle');
      const next: { managerId: string | null } | null = await this.prisma.employee.findFirst({ where: { id: cursor, tenantId }, select: { managerId: true } });
      cursor = next?.managerId ?? null;
    }
  }
}

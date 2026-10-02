import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../../common/audit/audit.service';
import { SessionCacheService } from '../../common/auth/session-cache.service';
import type { AuthUser } from '../../common/auth/auth-user';

/**
 * Data-subject rights (GDPR Art. 15/17/20, India DPDP Act 2023 §11-12).
 *
 * - Export: a person can download everything we hold about them, as JSON.
 * - Erasure: after an employee has exited, an admin can erase their personal
 *   data. Payslips are *retained* (amounts only, linked to an anonymised
 *   record) because tax and labour law require payroll records to be kept for
 *   several years — erasure rights do not override legal retention duties.
 * - Candidates: an application (and its resume file) can be deleted outright.
 */
@Injectable()
export class GdprService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly sessionCache: SessionCacheService,
  ) {}

  async exportMyData(user: AuthUser) {
    const record = await this.prisma.user.findFirst({
      where: { id: user.userId, tenantId: user.tenantId },
      select: {
        id: true, email: true, name: true, role: true, createdAt: true, lastLoginAt: true, isTwoFactorEnabled: true,
        tenant: { select: { name: true } },
        employee: {
          include: {
            leaves: true,
            attendance: true,
            salaryStructure: true,
            payslips: { where: { status: 'FINALIZED' } },
            documents: { select: { id: true, title: true, type: true, expiryDate: true, createdAt: true } },
            performanceReviews: true,
          },
        },
      },
    });
    if (!record) throw new NotFoundException('User not found');
    const notifications = await this.prisma.notification.findMany({
      where: { tenantId: user.tenantId, OR: [{ recipientUserId: user.userId }, { recipientEmail: user.email }] },
      select: { channel: true, title: true, status: true, createdAt: true },
    });

    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'DATA_EXPORT', resource: 'gdpr', resourceId: user.userId });
    return { exportedAt: new Date().toISOString(), subject: record, notifications };
  }

  async eraseEmployee(admin: AuthUser, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId: admin.tenantId }, include: { documents: true } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status !== 'EXITED') throw new BadRequestException('Offboard the employee before erasing their data');
    if (employee.anonymizedAt) throw new BadRequestException('This employee has already been erased');

    const placeholder = `erased-${employee.id}@erased.invalid`;
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employee.id },
        data: { firstName: 'Former', lastName: 'Employee', email: placeholder, phone: null, employeeCode: null, designation: null, anonymizedAt: new Date() },
      });
      if (employee.userId) {
        await tx.user.update({
          where: { id: employee.userId },
          data: { email: placeholder, name: 'Former Employee', passwordHash: '', twoFactorSecret: null, isTwoFactorEnabled: false, isActive: false, refreshToken: null, refreshTokenExpiry: null, tokenVersion: { increment: 1 } },
        });
        await tx.userSession.updateMany({
          where: { userId: employee.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'EMPLOYEE_ERASED' },
        });
      }
      await tx.leaveRequest.updateMany({ where: { employeeId: employee.id }, data: { reason: null, reviewNote: null } });
      await tx.performanceReview.updateMany({ where: { employeeId: employee.id }, data: { selfComments: null, managerComments: null } });
      await tx.document.deleteMany({ where: { employeeId: employee.id } });
      await tx.attendanceRecord.deleteMany({ where: { employeeId: employee.id } });
      await tx.salaryStructure.deleteMany({ where: { employeeId: employee.id } });
      await tx.notification.deleteMany({ where: { tenantId: admin.tenantId, recipientEmail: employee.email } });
    });
    if (employee.userId) this.sessionCache.forgetUser(employee.userId);
    for (const d of employee.documents) if (d.storageKey) await this.storage.delete(d.storageKey);

    await this.audit.log({ tenantId: admin.tenantId, userId: admin.userId, action: 'EMPLOYEE_ERASED', resource: 'gdpr', resourceId: employee.id });
    return { erased: true, retained: ['payslips (statutory retention)'] };
  }

  async deleteApplication(admin: AuthUser, applicationId: string) {
    const app = await this.prisma.application.findFirst({ where: { id: applicationId, tenantId: admin.tenantId } });
    if (!app) throw new NotFoundException('Application not found');
    await this.prisma.application.delete({ where: { id: app.id } });
    if (app.resumeKey) await this.storage.delete(app.resumeKey);
    await this.prisma.notification.deleteMany({ where: { tenantId: admin.tenantId, recipientEmail: app.candidateEmail } });
    await this.audit.log({ tenantId: admin.tenantId, userId: admin.userId, action: 'CANDIDATE_ERASED', resource: 'gdpr', resourceId: app.id });
    return { deleted: true };
  }
}

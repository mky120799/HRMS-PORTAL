import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

@Injectable()
export class GdprService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async exportUserData(tenantId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          include: {
            leaves: true,
            attendance: true,
            salaryStructure: true,
            payslips: true,
            documents: true,
            performanceReviews: true,
          }
        }
      }
    });

    if (!user || user.tenantId !== tenantId) {
      throw new NotFoundException('User not found');
    }

    // Log the export action for compliance
    await this.auditService.logAction(
      tenantId,
      userId,
      'EXPORT',
      'gdpr',
      userId,
      null,
      { status: 'success', timestamp: new Date().toISOString() }
    );

    // Sanitize sensitive info
    const { passwordHash, refreshToken, twoFactorSecret, ...safeUser } = user;

    return safeUser;
  }
}

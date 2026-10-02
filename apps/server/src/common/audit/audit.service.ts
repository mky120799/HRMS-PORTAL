import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Pagination } from '../validation/common.schemas';
import { paginate, paged } from '../validation/common.schemas';

/**
 * Security events: everything about sign-in, sessions, MFA, step-up, auth
 * policy, SSO configuration and identity-provider provisioning. Taxonomy:
 * docs/modules/auth.md#security-event-taxonomy.
 */
const SECURITY_EVENTS: Prisma.AuditLogWhereInput = {
  OR: [
    { resource: { in: ['auth', 'tenant_auth_policy', 'tenant_identity_provider', 'custom_role'] } },
    { action: { startsWith: 'SCIM_' } },
    { action: { in: ['SSO_USER_PROVISIONED', 'ROLE_SYNCED_FROM_IDP', 'ROLE_CHANGED', 'INVITE'] } },
  ],
};

export interface AuditEntry {
  tenantId: string;
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  oldValues?: Record<string, any> | null;
  newValues?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Append-only audit trail. Two sources feed it:
 *  1. AuditInterceptor — every successful mutating request (who/what/when/where).
 *  2. Explicit `log()` calls for business events that need before/after values
 *     (salary changes, role changes, payroll finalisation, logins).
 * Writes never fail the user's request; failures are logged instead.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          ...entry,
          oldValues: entry.oldValues ?? undefined,
          newValues: entry.newValues ?? undefined,
          userAgent: entry.userAgent?.slice(0, 300),
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to write audit log (${entry.action} ${entry.resource}): ${err.message}`);
    }
  }

  async list(tenantId: string, filters: { resource?: string; userId?: string; action?: string; category?: 'security' }, p: Pagination) {
    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(filters.resource ? { resource: filters.resource } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.category === 'security' ? SECURITY_EVENTS : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(p) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paged(items, total, p);
  }
}

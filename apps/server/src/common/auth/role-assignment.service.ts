import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TENANT_ROLES, type TenantRole } from '../constants/domain';
import type { AuthUser } from './auth-user';
import { ROLE_PERMISSIONS, type Permission, DELEGABLE_PERMISSIONS } from './permissions';
import { SessionCacheService } from './session-cache.service';

const isWorkspaceAdmin = (user: AuthUser) => user.role === 'ADMIN' && !user.customRoleId;

/** What to assign: a built-in role, or a workspace custom role (by id or by key). */
export type RoleTarget = { role: TenantRole } | { customRoleId: string } | { customRoleKey: string };

/** Who is assigning: an HRMS user, or an identity provider (SSO group sync / SCIM groups). */
export type RoleActor = { kind: 'user'; user: AuthUser } | { kind: 'idp'; providerId: string; via: 'sso' | 'scim' };

/**
 * The single place a user's role changes. Rules:
 *
 * - You cannot change your own role.
 * - **No escalation:** a person may only grant a role whose permissions they
 *   hold themselves, and only an ADMIN may grant ADMIN or change an ADMIN.
 *   (Previously an HR_ADMIN could promote anyone to ADMIN.)
 * - Identity providers can never grant ADMIN or change an existing ADMIN.
 * - The last active ADMIN cannot be demoted.
 * - A change bumps `tokenVersion` and revokes sessions, so the new permissions
 *   apply immediately; it is audited as ROLE_CHANGED (people) or
 *   ROLE_SYNCED_FROM_IDP (identity providers).
 */
@Injectable()
export class RoleAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessionCache: SessionCacheService,
  ) {}

  /** Returns true when the role actually changed. */
  async assign(tenantId: string, targetUserId: string, target: RoleTarget, actor: RoleActor): Promise<boolean> {
    const user = await this.prisma.user.findFirst({ where: { id: targetUserId, tenantId } });
    if (!user) throw new NotFoundException('User not found');
    const next = await this.resolve(tenantId, target);

    if (actor.kind === 'user') {
      if (actor.user.userId === user.id) throw new ForbiddenException('You cannot change your own role');
      if (user.role === 'ADMIN' && !isWorkspaceAdmin(actor.user)) {
        throw new ForbiddenException('Only an administrator can grant or change the ADMIN role');
      }
      this.assertMayGrant(actor.user, next);
    } else if (next.role === 'ADMIN' || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      return false; // administrators are managed in HRMS only
    }

    if (user.role === next.role && (user.customRoleId ?? null) === next.customRoleId) {
      // Same role; still record who manages it now.
      const managedBy = actor.kind === 'idp' ? `idp:${actor.providerId}` : null;
      if (user.roleManagedBy !== managedBy) {
        await this.prisma.user.update({ where: { id: user.id }, data: { roleManagedBy: managedBy } });
      }
      return false;
    }

    if (user.role === 'ADMIN' && next.role !== 'ADMIN') {
      const admins = await this.prisma.user.count({ where: { tenantId, role: 'ADMIN', isActive: true } });
      if (admins <= 1) throw new BadRequestException('A workspace must keep at least one active admin');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          role: next.role,
          customRoleId: next.customRoleId,
          roleManagedBy: actor.kind === 'idp' ? `idp:${actor.providerId}` : null,
          tokenVersion: { increment: 1 },
          refreshToken: null,
          refreshTokenExpiry: null,
        },
      });
      await tx.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: actor.kind === 'idp' ? 'ROLE_SYNCED_FROM_IDP' : 'ROLE_CHANGED' },
      });
    });
    this.sessionCache.forgetUser(user.id);
    await this.audit.log({
      tenantId,
      userId: actor.kind === 'user' ? actor.user.userId : null,
      action: actor.kind === 'user' ? 'ROLE_CHANGED' : 'ROLE_SYNCED_FROM_IDP',
      resource: 'users',
      resourceId: user.id,
      oldValues: { role: user.role, customRoleId: user.customRoleId },
      newValues: {
        role: next.role,
        customRoleId: next.customRoleId,
        customRoleName: next.customRoleName,
        ...(actor.kind === 'idp' ? { providerId: actor.providerId, via: actor.via } : {}),
      },
    });
    return true;
  }

  /**
   * For flows that create a user with a role (invitations): checks the same
   * no-escalation rules as `assign` and returns the resolved role.
   */
  async grantable(actor: AuthUser, target: RoleTarget) {
    const next = await this.resolve(actor.tenantId, target);
    this.assertMayGrant(actor, next);
    return next;
  }

  private assertMayGrant(actor: AuthUser, next: { role: TenantRole; permissions: readonly Permission[] }) {
    if (next.role === 'ADMIN' && !isWorkspaceAdmin(actor)) {
      throw new ForbiddenException('Only an administrator can grant or change the ADMIN role');
    }
    const missing = next.permissions.filter((permission) => !actor.permissions.includes(permission));
    if (missing.length) {
      throw new ForbiddenException(`You cannot grant permissions you do not have: ${missing.join(', ')}`);
    }
  }

  private async resolve(tenantId: string, target: RoleTarget) {
    if ('role' in target) {
      if (!(TENANT_ROLES as readonly string[]).includes(target.role)) throw new BadRequestException('Unknown role');
      return {
        role: target.role,
        customRoleId: null as string | null,
        customRoleName: null as string | null,
        permissions: ROLE_PERMISSIONS[target.role] as readonly Permission[],
      };
    }
    const custom = await this.prisma.customRole.findFirst({
      where: 'customRoleId' in target ? { id: target.customRoleId, tenantId } : { key: target.customRoleKey, tenantId },
    });
    if (!custom || !custom.isActive) throw new BadRequestException('Custom role not found or inactive');
    return {
      role: custom.baseRole as TenantRole,
      customRoleId: custom.id,
      customRoleName: custom.name,
      permissions: custom.permissions.filter((p): p is Permission => (DELEGABLE_PERMISSIONS as readonly string[]).includes(p)),
    };
  }
}

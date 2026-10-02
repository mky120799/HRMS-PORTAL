import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { SessionCacheService } from '../../common/auth/session-cache.service';
import { RolePermissionsService } from '../../common/auth/role-permissions.service';
import { DELEGABLE_PERMISSIONS, NON_DELEGABLE_PERMISSIONS, ROLE_PERMISSIONS } from '../../common/auth/permissions';
import { TENANT_ROLES } from '../../common/constants/domain';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateCustomRoleDto, UpdateCustomRoleDto } from './roles.dto';

/**
 * Workspace-defined roles. Permission edits apply within seconds (the per-request
 * permission lookup is cached for 30 s and cleared here); base-role changes are
 * written to every holder and revoke their sessions because the base role is in
 * the access token.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessionCache: SessionCacheService,
    private readonly rolePermissions: RolePermissionsService,
  ) {}

  async catalog(tenantId: string) {
    const custom = await this.prisma.customRole.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return {
      permissions: DELEGABLE_PERMISSIONS,
      nonDelegable: NON_DELEGABLE_PERMISSIONS,
      builtIn: TENANT_ROLES.map((key) => ({ key, permissions: ROLE_PERMISSIONS[key] })),
      custom: custom.map(({ _count, ...role }) => ({ ...role, userCount: _count.users })),
    };
  }

  async create(actor: AuthUser, dto: CreateCustomRoleDto) {
    const existing = await this.prisma.customRole.count({ where: { tenantId: actor.tenantId, key: dto.key } });
    if (existing) throw new ConflictException('A custom role with this key already exists');
    const role = await this.prisma.customRole.create({
      data: { tenantId: actor.tenantId, key: dto.key, name: dto.name, description: dto.description, baseRole: dto.baseRole, permissions: dto.permissions },
    });
    await this.audit.log({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'CUSTOM_ROLE_CREATED',
      resource: 'custom_role',
      resourceId: role.id,
      newValues: { key: role.key, baseRole: role.baseRole, permissions: role.permissions },
    });
    return role;
  }

  async update(actor: AuthUser, id: string, dto: UpdateCustomRoleDto) {
    const before = await this.prisma.customRole.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!before) throw new NotFoundException('Custom role not found');
    const baseRoleChanged = dto.baseRole !== undefined && dto.baseRole !== before.baseRole;
    const holders = await this.prisma.user.findMany({ where: { customRoleId: id }, select: { id: true } });

    const role = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.customRole.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          baseRole: dto.baseRole,
          permissions: dto.permissions,
          isActive: dto.isActive,
        },
      });
      if (baseRoleChanged && holders.length) {
        await tx.user.updateMany({ where: { customRoleId: id }, data: { role: updated.baseRole, tokenVersion: { increment: 1 } } });
        await tx.userSession.updateMany({
          where: { userId: { in: holders.map((h) => h.id) }, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'ROLE_CHANGED' },
        });
      }
      return updated;
    });
    this.rolePermissions.forget(id);
    if (baseRoleChanged) holders.forEach((h) => this.sessionCache.forgetUser(h.id));
    await this.audit.log({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'CUSTOM_ROLE_UPDATED',
      resource: 'custom_role',
      resourceId: id,
      oldValues: { name: before.name, baseRole: before.baseRole, permissions: before.permissions, isActive: before.isActive },
      newValues: { ...dto, affectedUsers: holders.length },
    });
    return role;
  }

  async remove(actor: AuthUser, id: string) {
    const role = await this.prisma.customRole.findFirst({ where: { id, tenantId: actor.tenantId }, include: { _count: { select: { users: true } } } });
    if (!role) throw new NotFoundException('Custom role not found');
    if (role._count.users > 0) {
      throw new ConflictException(`This role is assigned to ${role._count.users} user(s). Reassign them or deactivate the role instead.`);
    }
    await this.prisma.customRole.delete({ where: { id } });
    this.rolePermissions.forget(id);
    await this.audit.log({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'CUSTOM_ROLE_DELETED',
      resource: 'custom_role',
      resourceId: id,
      oldValues: { key: role.key, name: role.name },
    });
    return { message: 'Custom role deleted' };
  }
}

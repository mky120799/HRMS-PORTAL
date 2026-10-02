import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Role } from '../constants/domain';
import { DELEGABLE_PERMISSIONS, ROLE_PERMISSIONS, type Permission } from './permissions';

const TTL_MS = 30_000;

/**
 * Resolves effective permissions for a user: the built-in role map, or the
 * permissions of their custom role. Custom-role lookups are cached for 30 s per
 * instance (cleared immediately on the instance that edits the role), so edits
 * apply within seconds without a query per request.
 *
 * A custom role that is missing, inactive or belongs to another tenant grants
 * **no** permissions (self-service only). Falling back to the base role would be
 * wrong, because custom roles are often narrower than their base role.
 */
@Injectable()
export class RolePermissionsService {
  private readonly cache = new Map<string, { tenantId: string; permissions: readonly Permission[]; until: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async effective(role: Role, customRoleId: string | null | undefined, tenantId: string): Promise<readonly Permission[]> {
    if (!customRoleId) return ROLE_PERMISSIONS[role] ?? [];
    const cached = this.cache.get(customRoleId);
    if (cached && cached.until > Date.now()) return cached.tenantId === tenantId ? cached.permissions : [];

    const custom = await this.prisma.customRole.findUnique({
      where: { id: customRoleId },
      select: { tenantId: true, isActive: true, permissions: true },
    });
    // Defence in depth: even if stored data were tampered with, never grant non-delegable powers.
    const permissions =
      custom?.isActive ? custom.permissions.filter((p): p is Permission => (DELEGABLE_PERMISSIONS as readonly string[]).includes(p)) : [];
    if (custom) {
      if (this.cache.size > 10_000) this.cache.clear();
      this.cache.set(customRoleId, { tenantId: custom.tenantId, permissions, until: Date.now() + TTL_MS });
    }
    return custom?.tenantId === tenantId ? permissions : [];
  }

  forget(customRoleId: string) {
    this.cache.delete(customRoleId);
  }
}

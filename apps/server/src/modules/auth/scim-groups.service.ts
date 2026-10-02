import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { RoleAssignmentService, type RoleTarget } from '../../common/auth/role-assignment.service';
import { mappedRole } from './sso-mapping';
import { scimGroupSchema, scimPatchSchema, type ScimGroupInput, type ScimListQuery } from './scim.dto';
import { GROUP_SCHEMA, LIST_SCHEMA, scimError, type ScimContext } from './scim.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER_FILTER = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i;

type GroupWithMembers = Prisma.ScimGroupGetPayload<{ include: { members: { include: { user: { select: { email: true } } } } } }>;

/**
 * SCIM Groups. HRMS stores the groups an IdP pushes and their members; the
 * groups grant nothing themselves. After every membership change the affected
 * users' roles are recomputed from the provider's role mapping:
 *
 * - in a mapped group → that role (built-in or `custom:<KEY>`), through
 *   RoleAssignmentService, so IdPs still can never grant or change ADMIN;
 * - in no mapped group, and the role was last set by this IdP → back to EMPLOYEE;
 * - in no mapped group, and the role was set by a person in HRMS → unchanged.
 */
@Injectable()
export class ScimGroupsService {
  private readonly logger = new Logger(ScimGroupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly roles: RoleAssignmentService,
  ) {}

  async list(ctx: ScimContext, query: ScimListQuery) {
    const startIndex = Math.max(Number(query.startIndex ?? 1), 1);
    const count = Math.min(Math.max(Number(query.count ?? 100), 0), 100);
    const filter = this.parseFilter(query.filter);
    const where: Prisma.ScimGroupWhereInput = { providerId: ctx.provider.id, ...filter };
    const [groups, total] = await Promise.all([
      this.prisma.scimGroup.findMany({
        where,
        include: this.membersInclude,
        orderBy: { displayName: 'asc' },
        skip: startIndex - 1,
        take: count,
      }),
      this.prisma.scimGroup.count({ where }),
    ]);
    const withMembers = !this.excludesMembers(query);
    return {
      schemas: [LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: groups.length,
      Resources: groups.map((group) => this.format(group, withMembers)),
    };
  }

  async get(ctx: ScimContext, id: string, query: ScimListQuery = {}) {
    return this.format(await this.find(ctx, id), !this.excludesMembers(query));
  }

  async create(ctx: ScimContext, body: unknown) {
    const input = this.parse(body);
    const memberIds = await this.tenantUserIds(ctx, (input.members ?? []).map((member) => member.value));
    const group = await this.prisma.scimGroup
      .create({
        data: {
          tenantId: ctx.provider.tenantId,
          providerId: ctx.provider.id,
          displayName: input.displayName,
          externalId: input.externalId,
          members: { createMany: { data: memberIds.map((userId) => ({ userId })) } },
        },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException(scimError('A group with this displayName already exists', 409, 'uniqueness'));
        }
        throw error;
      });
    await this.logChange(ctx, 'SCIM_GROUP_CREATED', group.id, { displayName: group.displayName, members: memberIds.length });
    await this.syncRoles(ctx, memberIds);
    return this.format(await this.find(ctx, group.id), true);
  }

  async replace(ctx: ScimContext, id: string, body: unknown) {
    const input = this.parse(body);
    const existing = await this.find(ctx, id);
    const memberIds = await this.tenantUserIds(ctx, (input.members ?? []).map((member) => member.value));
    return this.apply(ctx, existing, { displayName: input.displayName, externalId: input.externalId ?? null, memberIds });
  }

  /**
   * Supports the PatchOp shapes Okta and Entra ID send for groups:
   * `add`/`replace` `members`, `remove` `members[value eq "<id>"]`, `remove`
   * `members` with a value list (Entra) or without (remove all), and
   * `replace` of `displayName`/`externalId` with or without a path.
   */
  async patch(ctx: ScimContext, id: string, body: unknown) {
    const parsed = scimPatchSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(scimError('Invalid SCIM PatchOp', 400, 'invalidSyntax'));
    const existing = await this.find(ctx, id);
    let displayName = existing.displayName;
    let externalId = existing.externalId;
    const members = new Set(existing.members.map((member) => member.userId));

    for (const operation of parsed.data.Operations) {
      const op = operation.op.toLowerCase();
      const path = operation.path?.trim() ?? '';
      const value = operation.value;
      const lowerPath = path.toLowerCase();
      const memberFilter = MEMBER_FILTER.exec(path);

      if (op === 'remove') {
        if (memberFilter) members.delete(memberFilter[1]);
        else if (lowerPath === 'members' && Array.isArray(value)) for (const id of this.memberValues(value)) members.delete(id);
        else if (lowerPath === 'members') members.clear();
        else throw new BadRequestException(scimError(`Unsupported remove path: ${path || '(none)'}`, 400, 'invalidPath'));
        continue;
      }
      if (op !== 'add' && op !== 'replace') {
        throw new BadRequestException(scimError(`Unsupported operation: ${operation.op}`, 400, 'invalidSyntax'));
      }

      const changes: Record<string, unknown> = !path
        ? value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {}
        : { [path]: value };
      for (const [key, item] of Object.entries(changes)) {
        const field = key.toLowerCase();
        if (field === 'displayname') {
          if (typeof item !== 'string' || !item.trim() || item.length > 200) {
            throw new BadRequestException(scimError('Invalid displayName', 400, 'invalidValue'));
          }
          displayName = item.trim();
        } else if (field === 'externalid') {
          externalId = typeof item === 'string' ? item.slice(0, 200) : null;
        } else if (field === 'members') {
          if (op === 'replace') members.clear();
          for (const id of this.memberValues(item)) members.add(id);
        }
        // `id` and unknown attributes are ignored (Okta sends `id` with displayName).
      }
    }

    const memberIds = await this.tenantUserIds(ctx, [...members]);
    return this.apply(ctx, existing, { displayName, externalId, memberIds });
  }

  async remove(ctx: ScimContext, id: string) {
    const existing = await this.find(ctx, id);
    await this.prisma.scimGroup.delete({ where: { id: existing.id } });
    await this.logChange(ctx, 'SCIM_GROUP_DELETED', existing.id, { displayName: existing.displayName });
    await this.syncRoles(ctx, existing.members.map((member) => member.userId));
  }

  private async apply(
    ctx: ScimContext,
    existing: GroupWithMembers,
    next: { displayName: string; externalId: string | null; memberIds: string[] },
  ) {
    const before = new Set(existing.members.map((member) => member.userId));
    const after = new Set(next.memberIds);
    const added = next.memberIds.filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !after.has(id));
    const renamed = next.displayName !== existing.displayName;

    await this.prisma
      .$transaction(async (tx) => {
        await tx.scimGroup.update({
          where: { id: existing.id },
          data: { displayName: next.displayName, externalId: next.externalId },
        });
        if (removed.length) await tx.scimGroupMember.deleteMany({ where: { groupId: existing.id, userId: { in: removed } } });
        if (added.length) {
          await tx.scimGroupMember.createMany({
            data: added.map((userId) => ({ groupId: existing.id, userId })),
            skipDuplicates: true,
          });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException(scimError('A group with this displayName already exists', 409, 'uniqueness'));
        }
        throw error;
      });

    if (renamed || added.length || removed.length) {
      await this.logChange(ctx, 'SCIM_GROUP_UPDATED', existing.id, {
        displayName: next.displayName,
        ...(renamed ? { previousDisplayName: existing.displayName } : {}),
        added: added.length,
        removed: removed.length,
      });
    }
    // A rename can change which mapping entry matches, so every member is re-evaluated.
    await this.syncRoles(ctx, renamed ? [...new Set([...after, ...removed])] : [...added, ...removed]);
    return this.format(await this.find(ctx, existing.id), true);
  }

  /** Recomputes roles for users whose group membership (for this provider) changed. */
  private async syncRoles(ctx: ScimContext, userIds: string[]) {
    if (!userIds.length) return;
    const managedBy = `idp:${ctx.provider.id}`;
    const users = await this.prisma.user.findMany({
      where: { tenantId: ctx.provider.tenantId, id: { in: userIds } },
      select: {
        id: true,
        roleManagedBy: true,
        scimGroups: {
          where: { group: { providerId: ctx.provider.id } },
          select: { group: { select: { displayName: true } } },
        },
      },
    });
    for (const user of users) {
      const groups = user.scimGroups.map((membership) => membership.group.displayName);
      const target: RoleTarget | null =
        mappedRole(ctx.provider.roleMapping, groups) ?? (user.roleManagedBy === managedBy ? { role: 'EMPLOYEE' } : null);
      if (!target) continue;
      try {
        await this.roles.assign(ctx.provider.tenantId, user.id, target, { kind: 'idp', providerId: ctx.provider.id, via: 'scim' });
      } catch (error) {
        // e.g. the mapping names a deactivated custom role: keep the current role, keep syncing others.
        this.logger.warn(`SCIM group role for user ${user.id} not applied: ${(error as Error).message}`);
      }
    }
  }

  private parse(body: unknown): ScimGroupInput {
    const parsed = scimGroupSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(scimError(`Invalid SCIM group: ${parsed.error.issues[0]?.path.join('.') || 'body'}`, 400, 'invalidSyntax'));
    }
    return parsed.data;
  }

  /** Keeps only ids of users in this workspace; unknown ids are ignored. */
  private async tenantUserIds(ctx: ScimContext, ids: string[]) {
    const candidates = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
    if (!candidates.length) return [];
    const users = await this.prisma.user.findMany({
      where: { tenantId: ctx.provider.tenantId, id: { in: candidates } },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  private memberValues(value: unknown): string[] {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    return list
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).value : undefined))
      .filter((id): id is string => typeof id === 'string');
  }

  private async find(ctx: ScimContext, id: string): Promise<GroupWithMembers> {
    const group = UUID_RE.test(id)
      ? await this.prisma.scimGroup.findFirst({ where: { id, providerId: ctx.provider.id }, include: this.membersInclude })
      : null;
    if (!group) throw new NotFoundException(scimError('SCIM group not found', 404));
    return group;
  }

  private get membersInclude() {
    return { members: { include: { user: { select: { email: true } } } } } as const;
  }

  private parseFilter(filter: string | undefined): Prisma.ScimGroupWhereInput {
    if (!filter) return {};
    const match = /^\s*(displayName|externalId|id)\s+eq\s+"([^"]*)"\s*$/i.exec(filter);
    if (!match) throw new BadRequestException(scimError('Unsupported filter', 400, 'invalidFilter'));
    const [, attribute, value] = match;
    const field = attribute.toLowerCase();
    if (field === 'displayname') return { displayName: value };
    if (field === 'externalid') return { externalId: value };
    return UUID_RE.test(value) ? { id: value } : { id: '00000000-0000-0000-0000-000000000000' };
  }

  private excludesMembers(query: ScimListQuery) {
    const excluded = (query.excludedAttributes ?? '').toLowerCase().split(',').map((item) => item.trim());
    const attributes = query.attributes?.toLowerCase().split(',').map((item) => item.trim());
    return excluded.includes('members') || (attributes !== undefined && !attributes.includes('members'));
  }

  private format(group: GroupWithMembers, withMembers: boolean) {
    return {
      schemas: [GROUP_SCHEMA],
      id: group.id,
      displayName: group.displayName,
      externalId: group.externalId ?? undefined,
      ...(withMembers
        ? { members: group.members.map((member) => ({ value: member.userId, display: member.user.email, type: 'User' })) }
        : {}),
      meta: { resourceType: 'Group', created: group.createdAt, lastModified: group.updatedAt },
    };
  }

  private logChange(ctx: ScimContext, action: string, groupId: string, values: Record<string, unknown>) {
    return this.audit.log({
      tenantId: ctx.provider.tenantId,
      userId: null,
      action,
      resource: 'scim_group',
      resourceId: groupId,
      newValues: { ...values, providerId: ctx.provider.id },
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, TenantIdentityProvider } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { SessionCacheService } from '../../common/auth/session-cache.service';
import { employeeLimit, effectivePlan } from '../../common/subscription/subscription-plans';
import { scimPatchSchema, scimUserSchema, type ScimUserInput } from './scim.dto';

export type ScimContext = {
  provider: TenantIdentityProvider;
};

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export { LIST_SCHEMA };
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class ScimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessionCache: SessionCacheService,
  ) {}

  /**
   * The bearer token's SHA-256 digest is looked up through a unique index, so
   * authentication is one indexed query regardless of how many tenants exist.
   * (Digest equality via the index is safe: tokens are 256-bit random values.)
   */
  async authenticate(authorization: string | undefined): Promise<ScimContext> {
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim();
    if (!token) throw new UnauthorizedException(this.error('Missing SCIM bearer token', 401));
    const provider = await this.prisma.tenantIdentityProvider.findUnique({
      where: { scimTokenHash: sha256(token) },
      include: { tenant: { select: { isActive: true } } },
    });
    if (!provider || !provider.scimEnabled || !provider.isActive || !provider.tenant.isActive) {
      throw new UnauthorizedException(this.error('Invalid SCIM bearer token', 401));
    }
    const { tenant: _tenant, ...rest } = provider;
    return { provider: rest };
  }

  parseUser(body: unknown): ScimUserInput {
    const parsed = scimUserSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(this.error(`Invalid SCIM user: ${parsed.error.issues[0]?.path.join('.') || 'body'}`, 400, 'invalidSyntax'));
    }
    return parsed.data;
  }

  serviceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'Bearer token',
          description: 'Use the SCIM token generated in HRMS identity-provider settings.',
          primary: true,
        },
      ],
    };
  }

  resourceTypes() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      Resources: [
        {
          id: 'User',
          name: 'User',
          endpoint: '/scim/v2/Users',
          schema: USER_SCHEMA,
        },
        {
          id: 'Group',
          name: 'Group',
          endpoint: '/scim/v2/Groups',
          schema: GROUP_SCHEMA,
        },
      ],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
    };
  }

  schemas() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
      Resources: [
        {
          id: USER_SCHEMA,
          name: 'User',
          description: 'Core user schema supported by HRMS SCIM provisioning.',
        },
        {
          id: GROUP_SCHEMA,
          name: 'Group',
          description: 'Groups; names are matched against the identity provider role mapping.',
        },
      ],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
    };
  }

  async list(ctx: ScimContext, query: { startIndex?: number; count?: number; filter?: string }) {
    const startIndex = Math.max(Number(query.startIndex ?? 1), 1);
    const count = Math.min(Math.max(Number(query.count ?? 100), 1), 100);
    const email = this.emailFilter(query.filter);
    const where: Prisma.UserWhereInput = {
      tenantId: ctx.provider.tenantId,
      ...(email ? { email } : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { employee: true },
        orderBy: { email: 'asc' },
        skip: startIndex - 1,
        take: count,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      schemas: [LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: users.length,
      Resources: users.map((user) => this.formatUser(user)),
    };
  }

  async get(ctx: ScimContext, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId: ctx.provider.tenantId },
      include: { employee: true },
    });
    if (!user) throw new NotFoundException(this.error('SCIM user not found', 404));
    return this.formatUser(user);
  }

  async create(ctx: ScimContext, body: unknown) {
    const input = this.parseUser(body);
    const email = this.inputEmail(input);
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: ctx.provider.tenantId, email } },
    });
    if (existing) throw new ConflictException(this.error('SCIM user already exists', 409, 'uniqueness'));
    const employeeCode = this.safeExternalId(input.externalId);
    if (employeeCode) {
      const existingCode = await this.prisma.employee.count({
        where: { tenantId: ctx.provider.tenantId, employeeCode },
      });
      if (existingCode) throw new ConflictException(this.error('SCIM externalId already exists', 409, 'uniqueness'));
    }
    await this.assertSeatAvailable(ctx.provider.tenantId);

    const parsedName = this.inputName(input, email);
    const active = input.active !== false;
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: ctx.provider.tenantId,
          email,
          name: parsedName.fullName,
          passwordHash: '',
          role: 'EMPLOYEE',
          isActive: active,
        },
      });
      await tx.employee.create({
        data: {
          tenantId: ctx.provider.tenantId,
          userId: user.id,
          email,
          firstName: parsedName.firstName,
          lastName: parsedName.lastName,
          designation: input.title,
          department: input.department ?? input['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User']?.department,
          employeeCode,
          status: active ? 'ACTIVE' : 'EXITED',
          exitDate: active ? null : new Date(),
        },
      });
      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { employee: true },
      });
    });
    await this.audit.log({
      tenantId: ctx.provider.tenantId,
      userId: null,
      action: 'SCIM_USER_CREATED',
      resource: 'users',
      resourceId: created.id,
      newValues: { email, providerId: ctx.provider.id },
    });
    return this.formatUser(created);
  }

  async replace(ctx: ScimContext, id: string, body: unknown) {
    const input = this.parseUser(body);
    const existing = await this.prisma.user.findFirst({
      where: { id, tenantId: ctx.provider.tenantId },
      include: { employee: true },
    });
    if (!existing) throw new NotFoundException(this.error('SCIM user not found', 404));
    return this.updateUser(ctx, id, input);
  }

  /**
   * Supports the PATCH shapes Okta and Entra ID send: `replace`/`add` with a
   * path (`active`, `userName`, `name.givenName`, `emails[type eq "work"].value`,
   * `title`, enterprise `department`…) or without a path and an object value.
   */
  async patch(ctx: ScimContext, id: string, body: unknown) {
    const parsed = scimPatchSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(this.error('Invalid SCIM PatchOp', 400, 'invalidSyntax'));
    const draft: Record<string, any> = {};
    for (const operation of parsed.data.Operations) {
      const op = operation.op.toLowerCase();
      if (op !== 'replace' && op !== 'add') continue;
      const path = operation.path?.trim();
      const value = operation.value;
      if (!path) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [key, item] of Object.entries(value as Record<string, unknown>)) this.applyPatchPath(draft, key, item);
        }
        continue;
      }
      this.applyPatchPath(draft, path, value);
    }
    return this.updateUser(ctx, id, this.parseUser(draft));
  }

  private applyPatchPath(draft: Record<string, any>, rawPath: string, value: unknown) {
    const path = rawPath.toLowerCase();
    const enterprise = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:user:';
    if (path === 'active') draft.active = value;
    else if (path === 'username') draft.userName = value;
    else if (path === 'externalid') draft.externalId = value;
    else if (path === 'title') draft.title = value;
    else if (path === 'department' || path === `${enterprise}department`) draft.department = value;
    else if (path === 'name') draft.name = value;
    else if (path.startsWith('name.')) {
      const field = { 'name.givenname': 'givenName', 'name.familyname': 'familyName', 'name.formatted': 'formatted' }[path];
      if (field) draft.name = { ...(draft.name ?? {}), [field]: value };
    } else if (path === 'emails') draft.emails = value;
    else if (path.startsWith('emails[')) draft.emails = [{ value, primary: true }];
    else if (path === enterprise.slice(0, -1) && value && typeof value === 'object') {
      const department = (value as Record<string, unknown>).department;
      if (department !== undefined) draft.department = department;
    }
  }

  async deactivate(ctx: ScimContext, id: string) {
    return this.updateUser(ctx, id, { active: false });
  }

  private async updateUser(ctx: ScimContext, id: string, input: ScimUserInput) {
    const existing = await this.prisma.user.findFirst({
      where: { id, tenantId: ctx.provider.tenantId },
      include: { employee: true },
    });
    if (!existing) throw new NotFoundException(this.error('SCIM user not found', 404));
    const email = input.userName || input.emails ? this.inputEmail(input) : existing.email;
    const department = input.department ?? input['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User']?.department;
    if (email !== existing.email) {
      const duplicate = await this.prisma.user.count({
        where: {
          tenantId: ctx.provider.tenantId,
          email,
          id: { not: id },
        },
      });
      if (duplicate) throw new ConflictException(this.error('SCIM userName/email already exists', 409, 'uniqueness'));
    }
    const parsedName = input.name ? this.inputName(input, email) : null;
    const active = input.active ?? existing.isActive;
    if (active && existing.employee?.status === 'EXITED') await this.assertSeatAvailable(ctx.provider.tenantId, existing.employee.id);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          email,
          isActive: active,
          ...(parsedName ? { name: parsedName.fullName } : {}),
          ...(!active ? { tokenVersion: { increment: 1 }, refreshToken: null, refreshTokenExpiry: null } : {}),
        },
      });
      if (existing.employee) {
        await tx.employee.update({
          where: { id: existing.employee.id },
          data: {
            email,
            ...(parsedName ? { firstName: parsedName.firstName, lastName: parsedName.lastName } : {}),
            designation: input.title,
            department,
            status: active ? 'ACTIVE' : 'EXITED',
            exitDate: active ? null : new Date(),
          },
        });
      } else {
        const name = parsedName ?? this.inputName({ userName: email }, email);
        await tx.employee.create({
          data: {
            tenantId: ctx.provider.tenantId,
            userId: id,
            email,
            firstName: name.firstName,
            lastName: name.lastName,
            designation: input.title,
            department,
            status: active ? 'ACTIVE' : 'EXITED',
            exitDate: active ? null : new Date(),
          },
        });
      }
      if (!active) {
        await tx.userSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'SCIM_DEACTIVATED' },
        });
      }
      return tx.user.findUniqueOrThrow({ where: { id }, include: { employee: true } });
    });
    if (!active) this.sessionCache.forgetUser(id);
    await this.audit.log({
      tenantId: ctx.provider.tenantId,
      userId: null,
      action: active ? 'SCIM_USER_UPDATED' : 'SCIM_USER_DEACTIVATED',
      resource: 'users',
      resourceId: id,
      newValues: { email, active, providerId: ctx.provider.id },
    });
    return this.formatUser(updated);
  }

  private async assertSeatAvailable(tenantId: string, exceptEmployeeId?: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const limit = employeeLimit(tenant);
    if (limit === Infinity) return;
    const activeEmployees = await this.prisma.employee.count({
      where: {
        tenantId,
        status: { not: 'EXITED' },
        ...(exceptEmployeeId ? { id: { not: exceptEmployeeId } } : {}),
      },
    });
    if (activeEmployees >= limit) {
      throw new ForbiddenException(
        this.error(`Your ${effectivePlan(tenant)} plan allows ${limit} active employees`, 403, 'mutability'),
      );
    }
  }

  private formatUser(user: Prisma.UserGetPayload<{ include: { employee: true } }>) {
    const employee = user.employee;
    return {
      schemas: [USER_SCHEMA],
      id: user.id,
      userName: user.email,
      active: user.isActive && employee?.status !== 'EXITED',
      name: {
        givenName: employee?.firstName ?? user.name.split(/\s+/)[0] ?? user.email,
        familyName: employee?.lastName ?? user.name.split(/\s+/).slice(1).join(' '),
        formatted: user.name,
      },
      emails: [{ value: user.email, primary: true, type: 'work' }],
      title: employee?.designation ?? undefined,
      department: employee?.department ?? undefined,
      externalId: employee?.employeeCode ?? undefined,
      meta: {
        resourceType: 'User',
        created: user.createdAt,
        lastModified: user.updatedAt,
      },
    };
  }

  private inputEmail(input: ScimUserInput) {
    const raw = input.userName ?? input.emails?.find((email) => email.primary)?.value ?? input.emails?.[0]?.value;
    const email = raw?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException(this.error('SCIM userName/email must be a valid email', 400, 'invalidValue'));
    }
    return email;
  }

  private inputName(input: ScimUserInput, email: string) {
    const firstName = input.name?.givenName?.trim() || input.name?.formatted?.trim().split(/\s+/)[0] || email.split('@')[0];
    const lastName = input.name?.familyName?.trim() || input.name?.formatted?.trim().split(/\s+/).slice(1).join(' ') || '';
    return {
      firstName: firstName.slice(0, 80),
      lastName: lastName.slice(0, 80),
      fullName: [firstName, lastName].filter(Boolean).join(' ').slice(0, 160) || email,
    };
  }

  private safeExternalId(externalId: string | undefined) {
    const value = externalId?.trim();
    if (!value) return undefined;
    return value.slice(0, 80);
  }

  private emailFilter(filter: string | undefined) {
    if (!filter) return undefined;
    const match = /^\s*userName\s+eq\s+"([^"]+)"\s*$/i.exec(filter);
    return match?.[1]?.toLowerCase();
  }

  error(detail: string, status: number, scimType?: string) {
    return scimError(detail, status, scimType);
  }
}

export function scimError(detail: string, status: number, scimType?: string) {
  return {
    schemas: [ERROR_SCHEMA],
    detail,
    status: String(status),
    ...(scimType ? { scimType } : {}),
  };
}

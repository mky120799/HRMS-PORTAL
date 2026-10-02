import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './auth-user';
import { ROLE_PERMISSIONS } from './permissions';
import { RoleAssignmentService } from './role-assignment.service';

const TENANT = 'tenant-1';

function actor(role: AuthUser['role'], extra: Partial<AuthUser> = {}): AuthUser {
  return {
    userId: `actor-${role}`,
    tenantId: TENANT,
    email: 'actor@example.com',
    role,
    employeeId: null,
    permissions: ROLE_PERMISSIONS[role],
    customRoleId: null,
    ...extra,
  } as AuthUser;
}

function setup(target: { role: string; customRoleId?: string | null; roleManagedBy?: string | null }, opts: { admins?: number } = {}) {
  const user = { id: 'target', tenantId: TENANT, customRoleId: null, roleManagedBy: null, ...target };
  const tx = { user: { update: jest.fn() }, userSession: { updateMany: jest.fn() } };
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue(user), count: jest.fn().mockResolvedValue(opts.admins ?? 2), update: jest.fn() },
    customRole: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'cr-1',
        tenantId: TENANT,
        name: 'Regional HR',
        baseRole: 'HR_MANAGER',
        isActive: true,
        // A non-delegable permission sneaked into stored data is ignored.
        permissions: ['employees.read_full', 'leave.review', 'roles.manage'],
      }),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn() };
  const sessionCache = { forgetUser: jest.fn() };
  const service = new RoleAssignmentService(prisma as any, audit as any, sessionCache as any);
  return { service, prisma, tx, audit, sessionCache };
}

describe('RoleAssignmentService', () => {
  it('lets an ADMIN change roles, revoking sessions and auditing', async () => {
    const { service, tx, audit, sessionCache } = setup({ role: 'EMPLOYEE' });
    await expect(service.assign(TENANT, 'target', { role: 'HR_ADMIN' }, { kind: 'user', user: actor('ADMIN') })).resolves.toBe(true);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'HR_ADMIN', customRoleId: null, roleManagedBy: null, tokenVersion: { increment: 1 } }) }),
    );
    expect(tx.userSession.updateMany).toHaveBeenCalled();
    expect(sessionCache.forgetUser).toHaveBeenCalledWith('target');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ROLE_CHANGED' }));
  });

  it('stops HR_ADMIN from granting ADMIN or changing an existing admin (escalation)', async () => {
    const hr = actor('HR_ADMIN');
    await expect(setup({ role: 'EMPLOYEE' }).service.assign(TENANT, 'target', { role: 'ADMIN' }, { kind: 'user', user: hr })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(setup({ role: 'ADMIN' }).service.assign(TENANT, 'target', { role: 'EMPLOYEE' }, { kind: 'user', user: hr })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('only allows granting permissions the actor holds', async () => {
    const hr = actor('HR_ADMIN');
    await expect(setup({ role: 'EMPLOYEE' }).service.assign(TENANT, 'target', { role: 'PAYROLL_ADMIN' }, { kind: 'user', user: hr })).rejects.toThrow(
      /payroll/,
    );
    await expect(setup({ role: 'EMPLOYEE' }).service.assign(TENANT, 'target', { role: 'HR_MANAGER' }, { kind: 'user', user: hr })).resolves.toBe(true);
  });

  it('treats an ADMIN-based custom role as not an administrator', async () => {
    const pseudoAdmin = actor('ADMIN', { customRoleId: 'cr-x' });
    await expect(setup({ role: 'EMPLOYEE' }).service.assign(TENANT, 'target', { role: 'ADMIN' }, { kind: 'user', user: pseudoAdmin })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses self-changes', async () => {
    const { service } = setup({ role: 'ADMIN' });
    await expect(service.assign(TENANT, 'target', { role: 'EMPLOYEE' }, { kind: 'user', user: actor('ADMIN', { userId: 'target' }) })).rejects.toThrow(
      /your own role/,
    );
  });

  it('keeps at least one active admin', async () => {
    const { service } = setup({ role: 'ADMIN' }, { admins: 1 });
    await expect(service.assign(TENANT, 'target', { role: 'EMPLOYEE' }, { kind: 'user', user: actor('ADMIN') })).rejects.toThrow(BadRequestException);
  });

  it('assigns custom roles with their base role, ignoring non-delegable permissions', async () => {
    const { service, tx } = setup({ role: 'EMPLOYEE' });
    // HR_ADMIN holds employees.read_full + leave.review; roles.manage is filtered out, so this is allowed.
    await expect(service.assign(TENANT, 'target', { customRoleId: 'cr-1' }, { kind: 'user', user: actor('HR_ADMIN') })).resolves.toBe(true);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'HR_MANAGER', customRoleId: 'cr-1' }) }));
  });

  it('rejects inactive custom roles', async () => {
    const { service, prisma } = setup({ role: 'EMPLOYEE' });
    prisma.customRole.findFirst.mockResolvedValue({ id: 'cr-1', tenantId: TENANT, isActive: false, baseRole: 'EMPLOYEE', permissions: [] });
    await expect(service.assign(TENANT, 'target', { customRoleId: 'cr-1' }, { kind: 'user', user: actor('ADMIN') })).rejects.toThrow(/inactive/);
  });

  describe('identity providers', () => {
    const idp = { kind: 'idp', providerId: 'p1', via: 'scim' } as const;

    it('never grant ADMIN or touch admins', async () => {
      await expect(setup({ role: 'EMPLOYEE' }).service.assign(TENANT, 'target', { role: 'ADMIN' }, idp)).resolves.toBe(false);
      const admin = setup({ role: 'ADMIN' });
      await expect(admin.service.assign(TENANT, 'target', { role: 'EMPLOYEE' }, idp)).resolves.toBe(false);
      expect(admin.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('record that the role is managed by the provider', async () => {
      const { service, tx, audit } = setup({ role: 'EMPLOYEE' });
      await service.assign(TENANT, 'target', { role: 'MANAGER' }, idp);
      expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roleManagedBy: 'idp:p1' }) }));
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ROLE_SYNCED_FROM_IDP', userId: null }));
    });

    it('take over management of an unchanged role without revoking sessions', async () => {
      const { service, prisma } = setup({ role: 'MANAGER' });
      await expect(service.assign(TENANT, 'target', { role: 'MANAGER' }, idp)).resolves.toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { roleManagedBy: 'idp:p1' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('grantable (invitations)', () => {
    it('applies the same rules without a target user', async () => {
      const { service } = setup({ role: 'EMPLOYEE' });
      await expect(service.grantable(actor('HR_MANAGER'), { role: 'ADMIN' })).rejects.toThrow(ForbiddenException);
      await expect(service.grantable(actor('HR_MANAGER'), { role: 'HR_ADMIN' })).rejects.toThrow(ForbiddenException);
      await expect(service.grantable(actor('HR_MANAGER'), { role: 'EMPLOYEE' })).resolves.toMatchObject({ role: 'EMPLOYEE' });
      await expect(service.grantable(actor('ADMIN'), { role: 'ADMIN' })).resolves.toMatchObject({ role: 'ADMIN' });
    });
  });
});

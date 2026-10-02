import { ROLE_PERMISSIONS } from './permissions';
import { RolePermissionsService } from './role-permissions.service';

function setup(role: { tenantId: string; isActive: boolean; permissions: string[] } | null) {
  const prisma = { customRole: { findUnique: jest.fn().mockResolvedValue(role) } };
  return { service: new RolePermissionsService(prisma as any), prisma };
}

describe('RolePermissionsService', () => {
  it('uses the built-in map without a custom role', async () => {
    const { service, prisma } = setup(null);
    await expect(service.effective('HR_MANAGER', null, 't1')).resolves.toEqual(ROLE_PERMISSIONS.HR_MANAGER);
    expect(prisma.customRole.findUnique).not.toHaveBeenCalled();
  });

  it("returns the custom role's delegable permissions and caches them", async () => {
    const { service, prisma } = setup({ tenantId: 't1', isActive: true, permissions: ['audit.read', 'roles.manage', 'platform.manage'] });
    await expect(service.effective('EMPLOYEE', 'cr', 't1')).resolves.toEqual(['audit.read']);
    await service.effective('EMPLOYEE', 'cr', 't1');
    expect(prisma.customRole.findUnique).toHaveBeenCalledTimes(1);
    service.forget('cr');
    await service.effective('EMPLOYEE', 'cr', 't1');
    expect(prisma.customRole.findUnique).toHaveBeenCalledTimes(2);
  });

  it('grants nothing for inactive, missing or other-tenant roles (no fallback to the base role)', async () => {
    await expect(setup({ tenantId: 't1', isActive: false, permissions: ['audit.read'] }).service.effective('HR_ADMIN', 'cr', 't1')).resolves.toEqual([]);
    await expect(setup(null).service.effective('HR_ADMIN', 'cr', 't1')).resolves.toEqual([]);
    await expect(setup({ tenantId: 't2', isActive: true, permissions: ['audit.read'] }).service.effective('HR_ADMIN', 'cr', 't1')).resolves.toEqual([]);
  });
});

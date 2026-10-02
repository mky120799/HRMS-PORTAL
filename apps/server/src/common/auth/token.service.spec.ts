import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenService } from './token.service';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { SessionCacheService } from './session-cache.service';
import { RolePermissionsService } from './role-permissions.service';
import { ROLE_PERMISSIONS } from './permissions';

const config = new ConfigService({ JWT_SECRET: 'x'.repeat(40) });
const tokens = new TokenService(new JwtService({}), config);

describe('TokenService', () => {
  it('round-trips a token for its own purpose', () => {
    const t = tokens.sign('reset', { sub: 'u1', ver: 3 });
    expect(tokens.verify('reset', t)).toMatchObject({ sub: 'u1', ver: 3, typ: 'reset' });
  });

  it('rejects a token presented for a different purpose', () => {
    const reset = tokens.sign('reset', { sub: 'u1' });
    expect(() => tokens.verify('access', reset)).toThrow();
    expect(() => tokens.verify('refresh', reset)).toThrow();
  });

  it('derives a distinct signing key per purpose', () => {
    expect(tokens.keyFor('access')).not.toEqual(tokens.keyFor('refresh'));
  });
});

describe('JwtStrategy.validate', () => {
  const findUnique = jest.fn();
  const findRole = jest.fn();
  const cache = new SessionCacheService();
  const roles = new RolePermissionsService({ customRole: { findUnique: findRole } } as any);
  const strategy = new JwtStrategy(tokens, { userSession: { findUnique } } as any, cache, roles);
  const good = { typ: 'access', sub: 'u1', tenantId: 't1', role: 'ADMIN', email: 'a@b.c', name: 'A', employeeId: 'e1' };
  const future = new Date(Date.now() + 60_000);

  beforeEach(() => findUnique.mockReset());

  it('builds the principal from a valid access token', async () => {
    await expect(strategy.validate(good)).resolves.toEqual({
      userId: 'u1',
      tenantId: 't1',
      role: 'ADMIN',
      email: 'a@b.c',
      name: 'A',
      employeeId: 'e1',
      sessionId: null,
      permissions: ROLE_PERMISSIONS.ADMIN,
      customRoleId: null,
    });
  });

  it('resolves a custom role to exactly its permissions, never non-delegable ones', async () => {
    findRole.mockResolvedValue({ tenantId: 't1', isActive: true, permissions: ['payroll.read', 'identity_providers.manage', 'roles.manage'] });
    const principal = await strategy.validate({ ...good, role: 'EMPLOYEE', crid: 'cr-1' });
    expect(principal).toMatchObject({ role: 'EMPLOYEE', customRoleId: 'cr-1', permissions: ['payroll.read'] });
  });

  it.each([
    ['inactive', { tenantId: 't1', isActive: false, permissions: ['payroll.read'] }],
    ['from another tenant', { tenantId: 't2', isActive: true, permissions: ['payroll.read'] }],
    ['deleted', null],
  ])('a custom role that is %s grants no permissions', async (label, role) => {
    findRole.mockResolvedValue(role);
    const principal = await strategy.validate({ ...good, role: 'MANAGER', crid: `cr-${label}` });
    expect(principal.permissions).toEqual([]);
  });

  it.each([
    ['wrong type', { ...good, typ: 'refresh' }],
    ['missing tenant', { ...good, tenantId: undefined }],
    ['empty tenant', { ...good, tenantId: '' }],
    ['unknown role', { ...good, role: 'ROOT' }],
  ])('fails closed on %s', async (_label, payload) => {
    await expect(strategy.validate(payload)).rejects.toThrow();
  });

  it('accepts a token whose session is active, and caches the answer', async () => {
    findUnique.mockResolvedValue({ userId: 'u1', revokedAt: null, expiresAt: future });
    await expect(strategy.validate({ ...good, sid: 's-active' })).resolves.toMatchObject({ sessionId: 's-active' });
    await strategy.validate({ ...good, sid: 's-active' });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('re-checks the database once a revocation on this instance clears the cache', async () => {
    findUnique.mockResolvedValue({ userId: 'u1', revokedAt: null, expiresAt: future });
    await strategy.validate({ ...good, sid: 's-revoked-here' });
    findUnique.mockResolvedValue({ userId: 'u1', revokedAt: new Date(), expiresAt: future });
    cache.forgetUser('u1');
    await expect(strategy.validate({ ...good, sid: 's-revoked-here' })).rejects.toThrow(/signed out/);
  });

  it.each([
    ['revoked', { userId: 'u1', revokedAt: new Date(), expiresAt: future }],
    ['expired', { userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() - 1000) }],
    ['owned by someone else', { userId: 'u2', revokedAt: null, expiresAt: future }],
    ['missing', null],
  ])('rejects a token whose session is %s (instant sign-out)', async (_label, session) => {
    findUnique.mockResolvedValue(session);
    await expect(strategy.validate({ ...good, sid: `s-${_label}` })).rejects.toThrow(/signed out/);
  });
});

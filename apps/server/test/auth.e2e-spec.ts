/**
 * Authentication hardening suite (docs/modules/authentication-hardening-plan.md,
 * phases 11–13). Each test proves one fix or guarantee against the real stack.
 * Requires DATABASE_URL (migrated) and RabbitMQ — see docs/TESTING.md.
 */
import { OTP } from 'otplib';
import { TokenService } from '../src/common/auth/token.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { OidcAuthService } from '../src/modules/auth/oidc-auth.service';
import { cookieValue, PASSWORD, TestClient, unique } from './helpers';

const otp = new OTP({ strategy: 'totp' });

describe('Authentication hardening', () => {
  let t: TestClient;
  let tokens: TokenService;
  let prisma: PrismaService;
  let crypto: CryptoService;

  type Admin = Awaited<ReturnType<TestClient['signup']>>;

  async function login(tenant: string, email: string, password = PASSWORD, ip?: string) {
    return t.request('POST', '/auth/login', { ip, body: { tenantId: tenant, email, password } });
  }

  /** Invites a user into the admin's workspace, activates them and signs in. */
  async function member(admin: Admin, role = 'EMPLOYEE') {
    const email = `member-${unique()}@example.com`;
    const invite = await t.request('POST', '/auth/invite', { token: admin.token, body: { email, name: 'Mia Member', role } });
    expect(invite.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: invite.body.data.userId } });
    const accept = await t.request('POST', '/auth/accept-invite', { body: { token: tokens.sign('invite', { sub: user.id, ver: user.tokenVersion }), password: PASSWORD } });
    expect(accept.status).toBe(200);
    const res = await login(admin.tenant.slug, email);
    return { email, userId: user.id, res, token: res.body.data?.accessToken as string };
  }

  /** Turns on TOTP for a signed-in user; returns the secret and recovery codes. */
  async function enableMfa(token: string, userId: string) {
    expect((await t.request('POST', '/auth/2fa/generate', { token })).status).toBe(201);
    const secret = await secretOf(userId);
    const on = await t.request('POST', '/auth/2fa/turn-on', { token, body: { code: otp.generateSync({ secret }) } });
    expect(on.status).toBe(200);
    return { secret, recoveryCodes: on.body.data.recoveryCodes as string[] };
  }

  /**
   * A valid authenticator code for this user. Each code can be used once, and a test may
   * need several within one 30-second window, so the stored step is cleared first —
   * equivalent to waiting for the next window.
   */
  async function freshCode(userId: string) {
    await prisma.user.update({ where: { id: userId }, data: { lastTotpStep: null } });
    return otp.generateSync({ secret: await secretOf(userId) });
  }

  async function secretOf(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return crypto.decrypt(user.twoFactorSecret!);
  }

  beforeAll(async () => {
    t = await TestClient.create();
    tokens = t.app.get(TokenService);
    prisma = t.app.get(PrismaService);
    crypto = t.app.get(CryptoService);
  });

  afterAll(() => t.close());

  describe('sessions', () => {
    it('keeps the refresh token out of the response body, in an httpOnly SameSite=Strict cookie', async () => {
      const admin = await t.signup();
      const res = await login(admin.tenant.slug, admin.email);
      expect(res.status).toBe(200);
      expect(res.body.data.refreshToken).toBeUndefined();
      const header = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('hrms_refresh='))!;
      expect(header).toMatch(/HttpOnly/);
      expect(header).toMatch(/SameSite=Strict/);
      expect(header).toMatch(/Path=\/api\/v1\/auth/);
    });

    it('logout invalidates the access token immediately, not after 15 minutes', async () => {
      const admin = await t.signup();
      expect((await t.request('GET', '/auth/me', { token: admin.token })).status).toBe(200);
      expect((await t.request('POST', '/auth/logout', { token: admin.token })).status).toBe(200);
      expect((await t.request('GET', '/auth/me', { token: admin.token })).status).toBe(401);
    });

    it('revoking another device signs that device out immediately', async () => {
      const admin = await t.signup();
      const other = await login(admin.tenant.slug, admin.email);
      const otherToken = other.body.data.accessToken as string;
      expect((await t.request('GET', '/auth/me', { token: otherToken })).status).toBe(200);
      const revoke = await t.request('DELETE', `/auth/sessions/${other.body.data.sessionId}`, { token: admin.token });
      expect(revoke.status).toBe(200);
      expect((await t.request('GET', '/auth/me', { token: otherToken })).status).toBe(401);
    });
  });

  describe('MFA', () => {
    it('locks the account after repeated wrong 2FA codes, and a known password cannot reset the counter', async () => {
      const admin = await t.signup();
      const user = await member(admin);
      await enableMfa(user.token, user.userId);
      const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

      for (let attempt = 0; attempt < 5; attempt++) {
        // Re-entering the correct password between guesses must not clear the failures.
        const first = await login(admin.tenant.slug, user.email, PASSWORD, ip);
        expect(first.body.data.twoFactorRequired).toBe(true);
        const guess = await t.request('POST', '/auth/2fa/authenticate', { ip, body: { tempToken: first.body.data.tempToken, code: '000000' } });
        expect(guess.status).toBe(401);
      }
      const locked = await login(admin.tenant.slug, user.email);
      expect(locked.status).toBe(401);
      expect(locked.body.message).toMatch(/Too many failed attempts/);

      const events = await prisma.auditLog.findMany({ where: { userId: user.userId, action: { in: ['MFA_CHALLENGE_FAILED', 'ACCOUNT_LOCKED'] } } });
      expect(events.some((e) => e.action === 'ACCOUNT_LOCKED')).toBe(true);
    });

    it('an authenticator code works only once, even inside its 30-second window', async () => {
      const admin = await t.signup();
      const user = await member(admin);
      const { secret } = await enableMfa(user.token, user.userId);
      await prisma.user.update({ where: { id: user.userId }, data: { lastTotpStep: null } });
      const code = otp.generateSync({ secret });
      const attempt = async () => {
        const first = await login(admin.tenant.slug, user.email);
        return t.request('POST', '/auth/2fa/authenticate', { body: { tempToken: first.body.data.tempToken, code } });
      };
      expect((await attempt()).status).toBe(200);
      expect((await attempt()).status).toBe(401); // replay of a code seen over a shoulder or phished
    });

    it('recovery codes work exactly once', async () => {
      const admin = await t.signup();
      const user = await member(admin);
      const { recoveryCodes } = await enableMfa(user.token, user.userId);
      const use = async () => {
        const first = await login(admin.tenant.slug, user.email);
        return t.request('POST', '/auth/2fa/authenticate', { body: { tempToken: first.body.data.tempToken, code: recoveryCodes[0] } });
      };
      expect((await use()).status).toBe(200);
      expect((await use()).status).toBe(401);
    });

    it('policy-required MFA: unenrolled users enrol at first sign-in and cannot turn it off', async () => {
      const admin = await t.signup();
      const me = await prisma.user.findFirstOrThrow({ where: { tenantId: admin.tenant.id, email: admin.email } });
      await enableMfa(admin.token, me.id);

      // Changing the policy is a sensitive action.
      const withoutStepUp = await t.request('PATCH', '/tenants/auth-policy', { token: admin.token, body: { requireMfaForAdmins: true } });
      expect(withoutStepUp.status).toBe(403);
      expect(withoutStepUp.body.code).toBe('STEP_UP_REQUIRED');
      const stepUp = await t.stepUp(admin.token, { code: await freshCode(me.id) });
      expect((await t.request('PATCH', '/tenants/auth-policy', { token: admin.token, body: { requireMfaForAdmins: true }, headers: stepUp })).status).toBe(200);

      // A second admin joins after the policy: they get an enrolment step, not a dead end.
      const second = await member(admin, 'ADMIN');
      expect(second.res.status).toBe(200);
      expect(second.res.body.data.mfaEnrollmentRequired).toBe(true);
      expect(second.res.body.data.accessToken).toBeUndefined();
      const enrollmentToken = second.res.body.data.enrollmentToken as string;
      expect((await t.request('GET', '/auth/me', { token: enrollmentToken })).status).toBe(401); // not an access token

      const start = await t.request('POST', '/auth/2fa/enroll/start', { body: { enrollmentToken } });
      expect(start.status).toBe(200);
      expect(start.body.data.qrCodeUrl).toMatch(/^data:image\/png/);
      const done = await t.request('POST', '/auth/2fa/enroll/complete', {
        body: { enrollmentToken, code: await freshCode(second.userId) },
      });
      expect(done.status).toBe(200);
      expect(done.body.data.accessToken).toBeTruthy();
      expect(done.body.data.recoveryCodes).toHaveLength(10);
      expect(cookieValue(done, 'hrms_refresh')).toBeTruthy();

      const off = await t.request('POST', '/auth/2fa/turn-off', {
        token: done.body.data.accessToken,
        body: { code: await freshCode(second.userId) },
      });
      expect(off.status).toBe(400);
      expect(off.body.message).toMatch(/requires two-factor/);
    });
  });

  describe('sign-in edge cases', () => {
    it('SSO exchange codes work exactly once', async () => {
      const admin = await t.signup();
      const user = await prisma.user.findFirstOrThrow({ where: { tenantId: admin.tenant.id, email: admin.email } });
      const code = tokens.sign('sso_exchange', { sub: user.id, ver: user.tokenVersion, jti: unique(), method: 'oidc' });
      expect((await t.request('POST', '/auth/sso/exchange', { body: { code } })).status).toBe(200);
      expect((await t.request('POST', '/auth/sso/exchange', { body: { code } })).status).toBe(401);
      const noJti = tokens.sign('sso_exchange', { sub: user.id, ver: user.tokenVersion, method: 'oidc' });
      expect((await t.request('POST', '/auth/sso/exchange', { body: { code: noJti } })).status).toBe(401);
    });

    it('with password login disabled, known and unknown emails get the same answer', async () => {
      const admin = await t.signup();
      await prisma.tenantAuthPolicy.upsert({
        where: { tenantId: admin.tenant.id },
        update: { allowPasswordLogin: false },
        create: { tenantId: admin.tenant.id, allowPasswordLogin: false },
      });
      const known = await login(admin.tenant.slug, admin.email);
      const unknown = await login(admin.tenant.slug, `nobody-${unique()}@example.com`);
      expect(known.status).toBe(403);
      expect(unknown.status).toBe(403);
      expect(unknown.body.message).toBe(known.body.message);
    });

    it('enforces password history on change', async () => {
      const admin = await t.signup();
      await prisma.tenantAuthPolicy.upsert({
        where: { tenantId: admin.tenant.id },
        update: { passwordHistoryCount: 3 },
        create: { tenantId: admin.tenant.id, passwordHistoryCount: 3 },
      });
      const next = 'N3w-Passw0rd-Value!';
      const changed = await t.request('POST', '/auth/change-password', { token: admin.token, body: { currentPassword: PASSWORD, newPassword: next } });
      expect(changed.status).toBe(200);
      const back = await t.request('POST', '/auth/change-password', {
        token: changed.body.data.accessToken,
        body: { currentPassword: next, newPassword: PASSWORD },
      });
      expect(back.status).toBe(400);
    });
  });

  describe('step-up', () => {
    it('sensitive actions need a recent re-authentication bound to the same session', async () => {
      const admin = await t.signup();
      const user = await member(admin);
      const employee = await prisma.employee.findFirstOrThrow({ where: { userId: user.userId } });
      const url = `/employees/${employee.id}/role`;

      const denied = await t.request('PATCH', url, { token: admin.token, body: { role: 'MANAGER' } });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('STEP_UP_REQUIRED');

      expect((await t.request('POST', '/auth/step-up', { token: admin.token, body: { password: 'wrong-password-1' } })).status).toBe(400);

      // A step-up token from another session (e.g. stolen alongside a different access token) is useless.
      const otherSession = (await login(admin.tenant.slug, admin.email)).body.data.accessToken as string;
      const foreign = await t.stepUp(otherSession);
      expect((await t.request('PATCH', url, { token: admin.token, body: { role: 'MANAGER' }, headers: foreign })).status).toBe(403);

      const ok = await t.request('PATCH', url, { token: admin.token, body: { role: 'MANAGER' }, headers: await t.stepUp(admin.token) });
      expect(ok.status).toBe(200);
    });
  });

  describe('identity providers', () => {
    it('only ADMIN may configure SSO; changes need step-up; JIT needs domains; secrets never reach the audit log', async () => {
      const admin = await t.signup();
      const itAdmin = await member(admin, 'IT_ADMIN');
      const body = { providerType: 'OIDC', name: 'Okta', issuerUrl: 'https://example.okta.com', clientId: 'client', clientSecret: 'super-secret-value' };

      expect((await t.request('POST', '/tenants/identity-providers', { token: itAdmin.token, body })).status).toBe(403);
      const noStepUp = await t.request('POST', '/tenants/identity-providers', { token: admin.token, body });
      expect(noStepUp.body.code).toBe('STEP_UP_REQUIRED');

      const stepUp = await t.stepUp(admin.token);
      const jitWithoutDomains = await t.request('POST', '/tenants/identity-providers', { token: admin.token, headers: stepUp, body: { ...body, jitProvisioning: true } });
      expect(jitWithoutDomains.status).toBe(400);
      const adminRole = await t.request('POST', '/tenants/identity-providers', { token: admin.token, headers: stepUp, body: { ...body, roleMapping: { Owners: 'ADMIN' } } });
      expect(adminRole.status).toBe(400); // ADMIN can never be granted by an IdP

      const created = await t.request('POST', '/tenants/identity-providers', { token: admin.token, headers: stepUp, body });
      expect(created.status).toBe(201);
      const provider = created.body.data[0];
      expect(provider.clientSecretEnc).toBeUndefined();
      const updated = await t.request('PATCH', `/tenants/identity-providers/${provider.id}`, { token: admin.token, headers: stepUp, body: { clientSecret: 'another-secret-value' } });
      expect(updated.status).toBe(200);

      const audit = await prisma.auditLog.findMany({ where: { tenantId: admin.tenant.id } });
      const serialized = JSON.stringify(audit);
      expect(serialized).not.toContain('super-secret-value');
      expect(serialized).not.toContain('another-secret-value');
    });

    it('refuses OIDC issuers on private networks (SSRF)', async () => {
      const admin = await t.signup();
      const provider = await prisma.tenantIdentityProvider.create({
        data: { tenantId: admin.tenant.id, providerType: 'OIDC', name: 'Metadata', issuerUrl: 'https://169.254.169.254', clientId: 'x' },
      });
      await expect(t.app.get(OidcAuthService).authorizationUrl(admin.tenant.slug, provider.id)).rejects.toThrow(/private or reserved/);
      const start = await t.request('GET', `/auth/oidc/start/${provider.id}?tenant=${admin.tenant.slug}`);
      expect(start.status).toBe(302);
      expect(start.headers.location).toMatch(/error=sso_failed/);
    });

    it('maps IdP groups to roles, never touches admins, and only provisions with a domain allow-list', async () => {
      const admin = await t.signup();
      const auth = t.app.get(AuthService);
      const provider = await prisma.tenantIdentityProvider.create({
        data: {
          tenantId: admin.tenant.id,
          providerType: 'OIDC',
          name: 'Okta',
          allowedDomains: ['example.com'],
          jitProvisioning: true,
          roleMapping: { 'HR Team': 'HR_ADMIN' },
        },
      });
      const email = `jit-${unique()}@example.com`;
      await auth.enterpriseSsoLogin(provider, email, 'oidc', {}, { name: 'Jo Jit', groups: ['hr team'] });
      const jit = await prisma.user.findUniqueOrThrow({ where: { tenantId_email: { tenantId: admin.tenant.id, email } } });
      expect(jit.role).toBe('HR_ADMIN');

      await auth.enterpriseSsoLogin(provider, admin.email, 'oidc', {}, { groups: ['HR Team'] });
      const adminUser = await prisma.user.findFirstOrThrow({ where: { tenantId: admin.tenant.id, email: admin.email } });
      expect(adminUser.role).toBe('ADMIN');

      const open = await prisma.tenantIdentityProvider.update({ where: { id: provider.id }, data: { allowedDomains: [] } });
      await expect(auth.enterpriseSsoLogin(open, `stranger-${unique()}@gmail.com`, 'oidc', {}, {})).rejects.toThrow(/No active account/);
    });
  });

  describe('SCIM', () => {
    it('speaks raw SCIM JSON, accepts application/scim+json and Entra-style PATCH, and is tenant-scoped', async () => {
      const admin = await t.signup();
      const other = await t.signup();
      const stepUp = await t.stepUp(admin.token);
      const created = await t.request('POST', '/tenants/identity-providers', {
        token: admin.token,
        headers: stepUp,
        body: { providerType: 'OIDC', name: 'Entra', issuerUrl: 'https://login.microsoftonline.com/x/v2.0', clientId: 'c', clientSecret: 's' },
      });
      const providerId = created.body.data[0].id;
      const rotated = await t.request('POST', `/tenants/identity-providers/${providerId}/scim-token`, { token: admin.token, headers: stepUp });
      expect(rotated.status).toBe(201);
      const scimHeaders = { authorization: `Bearer ${rotated.body.data.token}`, 'content-type': 'application/scim+json' };

      const email = `scim-${unique()}@example.com`;
      const create = await t.request('POST', '/scim/v2/Users', {
        headers: scimHeaders,
        payload: Buffer.from(JSON.stringify({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: email, name: { givenName: 'Sam', familyName: 'Scim' }, active: true, role: 'ADMIN' })),
      });
      expect(create.status).toBe(201);
      expect(create.body.success).toBeUndefined(); // no app envelope
      expect(create.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      const id = create.body.id as string;
      expect((await prisma.user.findUniqueOrThrow({ where: { id } })).role).toBe('EMPLOYEE'); // unknown attributes ignored

      const list = await t.request('GET', `/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`, { headers: scimHeaders });
      expect(list.body.totalResults).toBe(1);

      const patch = await t.request('PATCH', `/scim/v2/Users/${id}`, {
        headers: scimHeaders,
        payload: Buffer.from(JSON.stringify({ Operations: [{ op: 'Replace', path: 'active', value: 'False' }] })),
      });
      expect(patch.status).toBe(200);
      expect(patch.body.active).toBe(false);

      const bad = await t.request('GET', '/scim/v2/Users', { headers: { authorization: 'Bearer nope' } });
      expect(bad.status).toBe(401);
      expect(bad.body).toMatchObject({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '401' });

      // Another workspace's SCIM token cannot see this user.
      const otherStepUp = await t.stepUp(other.token);
      const otherProvider = await t.request('POST', '/tenants/identity-providers', {
        token: other.token,
        headers: otherStepUp,
        body: { providerType: 'OIDC', name: 'Okta', issuerUrl: 'https://o.okta.com', clientId: 'c', clientSecret: 's' },
      });
      const otherToken = await t.request('POST', `/tenants/identity-providers/${otherProvider.body.data[0].id}/scim-token`, { token: other.token, headers: otherStepUp });
      expect((await t.request('GET', `/scim/v2/Users/${id}`, { headers: { authorization: `Bearer ${otherToken.body.data.token}` } })).status).toBe(404);
    });
  });

  describe('roles', () => {
    async function employeeOf(userId: string) {
      return prisma.employee.findFirstOrThrow({ where: { userId } });
    }

    it('custom roles grant exactly their permissions, edits apply immediately, and admin powers stay out', async () => {
      const admin = await t.signup();
      const body = { key: 'compliance_reader', name: 'Compliance reader', baseRole: 'EMPLOYEE', permissions: ['audit.read'] };

      expect((await t.request('POST', '/roles', { token: admin.token, body })).body.code).toBe('STEP_UP_REQUIRED');
      const stepUp = await t.stepUp(admin.token);
      for (const forbidden of ['roles.manage', 'identity_providers.manage', 'platform.manage']) {
        const res = await t.request('POST', '/roles', { token: admin.token, headers: stepUp, body: { ...body, permissions: [forbidden] } });
        expect(res.status).toBe(400);
      }
      expect((await t.request('POST', '/roles', { token: admin.token, headers: stepUp, body: { ...body, key: 'ADMIN' } })).status).toBe(400);
      const created = await t.request('POST', '/roles', { token: admin.token, headers: stepUp, body });
      expect(created.status).toBe(201);
      const role = created.body.data;
      expect(role.key).toBe('COMPLIANCE_READER');

      const user = await member(admin);
      expect((await t.request('GET', '/audit', { token: user.token })).status).toBe(403);
      const employee = await employeeOf(user.userId);
      const assigned = await t.request('PATCH', `/employees/${employee.id}/role`, { token: admin.token, headers: stepUp, body: { customRoleId: role.id } });
      expect(assigned.status).toBe(200);
      expect((await t.request('GET', '/auth/me', { token: user.token })).status).toBe(401); // old sessions end on a role change

      const relogin = await login(admin.tenant.slug, user.email);
      expect(relogin.body.data.user).toMatchObject({ role: 'EMPLOYEE', customRoleId: role.id, permissions: ['audit.read'] });
      const token = relogin.body.data.accessToken as string;
      expect((await t.request('GET', '/audit', { token })).status).toBe(200);
      expect((await t.request('GET', '/employees?pageSize=1', { token })).status).toBe(200); // self-service still works

      // Permission edits apply without signing the user out.
      expect((await t.request('PATCH', `/roles/${role.id}`, { token: admin.token, headers: stepUp, body: { permissions: [] } })).status).toBe(200);
      expect((await t.request('GET', '/audit', { token })).status).toBe(403);
      await t.request('PATCH', `/roles/${role.id}`, { token: admin.token, headers: stepUp, body: { permissions: ['audit.read'] } });
      expect((await t.request('GET', '/audit', { token })).status).toBe(200);
      await t.request('PATCH', `/roles/${role.id}`, { token: admin.token, headers: stepUp, body: { isActive: false } });
      expect((await t.request('GET', '/audit', { token })).status).toBe(403); // inactive roles grant nothing

      expect((await t.request('DELETE', `/roles/${role.id}`, { token: admin.token, headers: stepUp })).status).toBe(409);
      const catalog = await t.request('GET', '/roles', { token: admin.token });
      expect(catalog.body.data.custom[0]).toMatchObject({ key: 'COMPLIANCE_READER', userCount: 1, isActive: false });
      expect(catalog.body.data.permissions).not.toContain('roles.manage');
    });

    it('nobody can grant more than they hold: HR cannot mint admins, by role change or by invitation', async () => {
      const admin = await t.signup();
      const hr = await member(admin, 'HR_ADMIN');
      const hrManager = await member(admin, 'HR_MANAGER');
      const target = await member(admin);
      const hrStepUp = await t.stepUp(hr.token);
      const targetEmployee = await employeeOf(target.userId);
      const adminEmployee = await prisma.employee.findFirstOrThrow({ where: { tenantId: admin.tenant.id, email: admin.email } });
      const change = (token: string, headers: Record<string, string>, employeeId: string, body: object) =>
        t.request('PATCH', `/employees/${employeeId}/role`, { token, headers, body });

      expect((await change(hr.token, hrStepUp, targetEmployee.id, { role: 'ADMIN' })).status).toBe(403);
      expect((await change(hr.token, hrStepUp, adminEmployee.id, { role: 'EMPLOYEE' })).status).toBe(403);
      expect((await change(hr.token, hrStepUp, targetEmployee.id, { role: 'PAYROLL_ADMIN' })).status).toBe(403); // payroll powers HR lacks
      expect((await change(hr.token, hrStepUp, (await employeeOf(hr.userId)).id, { role: 'HR_MANAGER' })).status).toBe(403); // self
      expect((await change(hr.token, hrStepUp, targetEmployee.id, { role: 'HR_MANAGER' })).status).toBe(200);
      expect((await change(hr.token, hrStepUp, targetEmployee.id, { role: 'MANAGER', customRoleId: targetEmployee.id })).status).toBe(400);

      const invite = (token: string, role: string) =>
        t.request('POST', '/auth/invite', { token, body: { email: `inv-${unique()}@example.com`, name: 'Ivy Invite', role } });
      expect((await invite(hrManager.token, 'ADMIN')).status).toBe(403);
      expect((await invite(hrManager.token, 'HR_ADMIN')).status).toBe(403);
      expect((await invite(hrManager.token, 'EMPLOYEE')).status).toBe(201);
      expect((await invite(admin.token, 'ADMIN')).status).toBe(201);

      const audit = await prisma.auditLog.findMany({ where: { tenantId: admin.tenant.id, action: 'ROLE_CHANGED' } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ userId: hr.userId, resourceId: target.userId });
    });
  });

  describe('SCIM groups', () => {
    it('set roles from the mapping (built-in or custom), revert when removed, and never touch admins or manual roles', async () => {
      const admin = await t.signup();
      const stepUp = await t.stepUp(admin.token);
      const regional = await t.request('POST', '/roles', {
        token: admin.token,
        headers: stepUp,
        body: { key: 'REGIONAL_HR', name: 'Regional HR', baseRole: 'HR_MANAGER', permissions: ['employees.read_full', 'leave.review'] },
      });
      const created = await t.request('POST', '/tenants/identity-providers', {
        token: admin.token,
        headers: stepUp,
        body: {
          providerType: 'OIDC',
          name: 'Okta',
          issuerUrl: 'https://example.okta.com',
          clientId: 'c',
          clientSecret: 's',
          allowedDomains: ['example.com'],
          roleMapping: { 'HR Team': 'MANAGER', Regional: 'custom:REGIONAL_HR' },
        },
      });
      expect(created.status).toBe(201);
      const providerId = created.body.data[0].id as string;
      const rotated = await t.request('POST', `/tenants/identity-providers/${providerId}/scim-token`, { token: admin.token, headers: stepUp });
      const headers = { authorization: `Bearer ${rotated.body.data.token}`, 'content-type': 'application/scim+json' };
      const scim = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) =>
        t.request(method, `/scim/v2${url}`, { headers, ...(body ? { payload: Buffer.from(JSON.stringify(body)) } : {}) });
      const userOf = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

      const alice = (await scim('POST', '/Users', { userName: `alice-${unique()}@example.com`, name: { givenName: 'Alice' } })).body.id as string;
      const bob = (await scim('POST', '/Users', { userName: `bob-${unique()}@example.com`, name: { givenName: 'Bob' } })).body.id as string;

      const hrTeam = await scim('POST', '/Groups', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'HR Team', members: [{ value: alice }] });
      expect(hrTeam.status).toBe(201);
      expect(hrTeam.body).toMatchObject({ displayName: 'HR Team', members: [{ value: alice }] });
      expect(await userOf(alice)).toMatchObject({ role: 'MANAGER', roleManagedBy: `idp:${providerId}` });
      expect((await scim('POST', '/Groups', { displayName: 'HR Team' })).status).toBe(409);

      // Okta-style removal → back to EMPLOYEE, because the IdP had set the role.
      const removed = await scim('PATCH', `/Groups/${hrTeam.body.id}`, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'remove', path: `members[value eq "${alice}"]` }],
      });
      expect(removed.status).toBe(200);
      expect(removed.body.members).toEqual([]);
      expect(await userOf(alice)).toMatchObject({ role: 'EMPLOYEE', customRoleId: null });

      // Custom role by key; Entra-style add.
      const regionalGroup = await scim('POST', '/Groups', { displayName: 'Regional' });
      await scim('PATCH', `/Groups/${regionalGroup.body.id}`, { Operations: [{ op: 'Add', path: 'members', value: [{ value: alice }] }] });
      expect(await userOf(alice)).toMatchObject({ role: 'HR_MANAGER', customRoleId: regional.body.data.id });

      // A role set by a person in HRMS is not reverted by unmapped groups.
      const bobEmployee = await prisma.employee.findFirstOrThrow({ where: { userId: bob } });
      await t.request('PATCH', `/employees/${bobEmployee.id}/role`, { token: admin.token, headers: stepUp, body: { role: 'FINANCE' } });
      const other = await scim('POST', '/Groups', { displayName: 'Sales', members: [{ value: bob }] });
      await scim('PUT', `/Groups/${other.body.id}`, { displayName: 'Sales', members: [] });
      expect((await userOf(bob)).role).toBe('FINANCE');

      // Admins are never changed; unknown and foreign member ids are ignored.
      const stranger = await t.signup();
      await scim('PATCH', `/Groups/${hrTeam.body.id}`, {
        Operations: [{ op: 'add', path: 'members', value: [{ value: admin.user.id }, { value: stranger.user.id }, { value: 'not-a-user' }] }],
      });
      expect((await userOf(admin.user.id)).role).toBe('ADMIN');
      expect((await userOf(stranger.user.id)).role).toBe('ADMIN');
      expect((await scim('GET', `/Groups/${hrTeam.body.id}`)).body.members.map((m: { value: string }) => m.value)).toEqual([admin.user.id]);

      const filtered = await scim('GET', `/Groups?filter=${encodeURIComponent('displayName eq "Regional"')}&excludedAttributes=members`);
      expect(filtered.body).toMatchObject({ totalResults: 1, Resources: [{ displayName: 'Regional' }] });
      expect(filtered.body.Resources[0].members).toBeUndefined();

      // Deleting the group removes the IdP-granted role.
      expect((await scim('DELETE', `/Groups/${regionalGroup.body.id}`)).status).toBe(204);
      expect(await userOf(alice)).toMatchObject({ role: 'EMPLOYEE', customRoleId: null });

      // SSO group claims can map to custom roles too.
      await t.app.get(AuthService).enterpriseSsoLogin(
        { ...(await prisma.tenantIdentityProvider.findUniqueOrThrow({ where: { id: providerId } })) },
        (await userOf(alice)).email,
        'oidc',
        {},
        { groups: ['regional'] },
      );
      expect((await userOf(alice)).customRoleId).toBe(regional.body.data.id);

      const events = await prisma.auditLog.findMany({ where: { tenantId: admin.tenant.id, action: { startsWith: 'SCIM_GROUP_' } } });
      expect(new Set(events.map((e) => e.action))).toEqual(new Set(['SCIM_GROUP_CREATED', 'SCIM_GROUP_UPDATED', 'SCIM_GROUP_DELETED']));
      const types = await scim('GET', '/ResourceTypes');
      expect(types.body.Resources.map((r: { id: string }) => r.id)).toEqual(['User', 'Group']);
    });
  });

  describe('security events', () => {
    it('records failures and reset requests, and the security filter returns only security events', async () => {
      const admin = await t.signup();
      await login(admin.tenant.slug, admin.email, 'wrong-password-1');
      await t.request('POST', '/auth/reset-password-request', { body: { tenantId: admin.tenant.slug, email: admin.email } });
      await t.request('POST', '/employees', { token: admin.token, body: { firstName: 'Non', lastName: 'Security', email: `ns-${unique()}@example.com` } });

      const res = await t.request('GET', '/audit?category=security&pageSize=100', { token: admin.token });
      expect(res.status).toBe(200);
      const actions = res.body.data.items.map((item: { action: string }) => item.action);
      expect(actions).toEqual(expect.arrayContaining(['LOGIN_FAILED', 'PASSWORD_RESET_REQUESTED']));
      expect(res.body.data.items.every((item: { resource: string }) => item.resource !== 'employees')).toBe(true);
    });
  });
});

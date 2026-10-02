/**
 * Security regression suite. Each block corresponds to a vulnerability found
 * in the pre-production audit and proves it stays fixed.
 * Requires DATABASE_URL (migrated) and RabbitMQ — see docs/TESTING.md.
 */
import { TokenService } from '../src/common/auth/token.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { cookieValue, FAKE_PDF, multipart, PASSWORD, TestClient, unique } from './helpers';

describe('Security', () => {
  let t: TestClient;
  let tokens: TokenService;
  let prisma: PrismaService;
  let A: Awaited<ReturnType<TestClient['signup']>>;
  let B: Awaited<ReturnType<TestClient['signup']>>;

  /** Invites a user into A's workspace and activates them; returns an access token. */
  async function createMember(admin: typeof A, role: 'EMPLOYEE' | 'MANAGER' = 'EMPLOYEE') {
    const email = `member-${unique()}@example.com`;
    const invite = await t.request('POST', '/auth/invite', { token: admin.token, body: { email, name: 'Eve Employee', role } });
    expect(invite.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: invite.body.data.userId } });
    const inviteToken = tokens.sign('invite', { sub: user.id, ver: user.tokenVersion });
    expect((await t.request('POST', '/auth/accept-invite', { body: { token: inviteToken, password: PASSWORD } })).status).toBe(200);
    const login = await t.request('POST', '/auth/login', { body: { tenantId: admin.tenant.slug, email, password: PASSWORD } });
    expect(login.status).toBe(200);
    return { token: login.body.data.accessToken as string, user: login.body.data.user, email, inviteToken };
  }

  beforeAll(async () => {
    t = await TestClient.create();
    tokens = t.app.get(TokenService);
    prisma = t.app.get(PrismaService);
    A = await t.signup();
    B = await t.signup();
  });

  afterAll(() => t.close());

  describe('authentication is on by default', () => {
    it('rejects unauthenticated access to business endpoints', async () => {
      for (const url of ['/employees', '/leave-requests', '/payroll/my-payslips', '/notifications', '/audit']) {
        expect((await t.request('GET', url)).status).toBe(401);
      }
    });

    it('no longer exposes the public "register as admin of any tenant" endpoint', async () => {
      const res = await t.request('POST', '/auth/register', { body: { tenantId: A.tenant.id, email: 'x@evil.test', password: PASSWORD, name: 'x' } });
      expect(res.status).toBe(404);
    });

    it('no longer exposes internal service endpoints guarded by a default secret', async () => {
      const headers = { 'x-internal-secret': 'super-secret-internal-key' };
      expect((await t.request('POST', '/internal/notifications', { headers, body: {} })).status).toBe(404);
      expect((await t.request('GET', `/internal/tenants/${A.tenant.id}`, { headers })).status).toBe(404);
    });
  });

  describe('token confusion', () => {
    it.each(['refresh', 'invite', 'reset', 'two_factor'] as const)('a %s token cannot be used as an access token', async (purpose) => {
      const forged = tokens.sign(purpose, { sub: A.user.id, ver: 0, tenantId: A.tenant.id, role: 'ADMIN' });
      expect((await t.request('GET', '/employees', { token: forged })).status).toBe(401);
    });

    it('an access token without a tenant is rejected (Prisma would otherwise drop the tenant filter)', async () => {
      const noTenant = tokens.sign('access', { sub: A.user.id, role: 'ADMIN', email: A.email });
      expect((await t.request('GET', '/employees', { token: noTenant })).status).toBe(401);
    });
  });

  describe('tenant isolation', () => {
    it('one tenant cannot read or modify another tenant’s employees', async () => {
      const created = await t.request('POST', '/employees', { token: A.token, body: { email: `iso-${unique()}@example.com`, firstName: 'Iso', lastName: 'Lated' } });
      expect(created.status).toBe(201);
      const id = created.body.data.id;

      expect((await t.request('GET', `/employees/${id}`, { token: B.token })).status).toBe(404);
      expect((await t.request('PATCH', `/employees/${id}`, { token: B.token, body: { department: 'Hacked' } })).status).toBe(404);
      const list = await t.request('GET', '/employees?pageSize=100', { token: B.token });
      expect(list.body.data.items.map((e: any) => e.id)).not.toContain(id);
    });

    it('public careers pages are scoped to one company and never leak tenant ids', async () => {
      const job = await t.request('POST', '/hiring/jobs', { token: A.token, body: { title: 'Engineer', department: 'Eng', description: 'Build and run production services for customers.' } });
      expect(job.status).toBe(201);

      const careersB = await t.request('GET', `/careers/${B.tenant.slug}`);
      expect(careersB.status).toBe(200);
      expect(careersB.body.data.jobs.map((j: any) => j.id)).not.toContain(job.body.data.id);

      const careersA = await t.request('GET', `/careers/${A.tenant.slug}`);
      expect(JSON.stringify(careersA.body)).not.toContain(A.tenant.id);
    });

    it('cannot change another tenant’s application status', async () => {
      const job = await t.request('POST', '/hiring/jobs', { token: A.token, body: { title: 'Designer', department: 'Design', description: 'Design delightful and accessible product experiences.' } });
      const form = multipart({ candidateName: 'Cara Candidate', candidateEmail: `cand-${unique()}@example.com`, consent: 'true' }, { field: 'resume', filename: 'cv.pdf', content: FAKE_PDF, type: 'application/pdf' });
      const applied = await t.request('POST', `/careers/${A.tenant.slug}/jobs/${job.body.data.id}/apply`, form);
      expect(applied.status).toBe(201);

      const res = await t.request('PATCH', `/hiring/applications/${applied.body.data.applicationId}`, { token: B.token, body: { status: 'REJECTED' } });
      expect(res.status).toBe(404);
    });
  });

  describe('role-based access', () => {
    let employee: Awaited<ReturnType<typeof createMember>>;
    beforeAll(async () => {
      employee = await createMember(A);
    });

    it('employees cannot perform admin actions', async () => {
      expect((await t.request('POST', '/employees', { token: employee.token, body: { email: `x-${unique()}@example.com`, firstName: 'X' } })).status).toBe(403);
      expect((await t.request('POST', '/tenants/seed-demo', { token: employee.token })).status).toBe(403);
      expect((await t.request('GET', '/audit', { token: employee.token })).status).toBe(403);
      expect((await t.request('POST', '/payroll/runs/generate', { token: employee.token, body: { month: 1, year: 2026 } })).status).toBe(403);
    });

    it('employees cannot use the platform to send arbitrary email', async () => {
      const res = await t.request('POST', '/notifications/compose-email', { token: employee.token, body: { to: 'victim@elsewhere.test', subject: 'hi', body: 'x' } });
      expect(res.status).toBe(403);
      expect((await t.request('POST', '/notifications', { token: employee.token, body: { channel: 'EMAIL', recipientEmail: 'victim@elsewhere.test', title: 'x', body: 'x' } })).status).toBe(404);
    });

    it('even admins can only email members of their own workspace', async () => {
      const res = await t.request('POST', '/notifications/compose-email', { token: A.token, body: { to: 'victim@elsewhere.test', subject: 'hi', body: 'x' } });
      expect(res.status).toBe(400);
    });

    it('employees cannot read credential links from the notification log', async () => {
      const res = await t.request('GET', '/notifications?scope=all', { token: employee.token });
      expect(res.status).toBe(403);
      const adminView = await t.request('GET', '/notifications?scope=all&pageSize=100', { token: A.token });
      const invites = adminView.body.data.items.filter((n: any) => n.subject?.includes('invited'));
      expect(invites.length).toBeGreaterThan(0);
      invites.forEach((n: any) => expect(n.body).not.toContain('token='));
    });

    it('invite links are single-use', async () => {
      const reuse = await t.request('POST', '/auth/accept-invite', { body: { token: employee.inviteToken, password: 'An0ther-Passw0rd' } });
      expect(reuse.status).toBe(400);
    });
  });

  describe('sessions', () => {
    it('refresh tokens rotate, and replaying an old one revokes the session', async () => {
      const s = await t.signup();
      const cookie = (value: string) => ({ cookie: `hrms_refresh=${encodeURIComponent(value)}` });
      const first = await t.request('POST', '/auth/refresh', { headers: cookie(s.refreshToken), body: {} });
      expect(first.status).toBe(200);
      const rotated = cookieValue(first, 'hrms_refresh')!;
      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(s.refreshToken);
      const replay = await t.request('POST', '/auth/refresh', { headers: cookie(s.refreshToken), body: {} });
      expect(replay.status).toBe(401);
      // The legitimate newer token is also revoked after reuse is detected.
      const newer = await t.request('POST', '/auth/refresh', { headers: cookie(rotated), body: {} });
      expect(newer.status).toBe(401);
    });

    it('locks the account after repeated failed logins', async () => {
      const s = await t.signup();
      const ip = '192.0.2.10';
      for (let i = 0; i < 5; i++) {
        expect((await t.request('POST', '/auth/login', { ip, body: { tenantId: s.tenant.slug, email: s.email, password: 'wrong-password-1' } })).status).toBe(401);
      }
      const locked = await t.request('POST', '/auth/login', { ip, body: { tenantId: s.tenant.slug, email: s.email, password: PASSWORD } });
      expect(locked.status).toBe(401);
      expect(locked.body.message).toMatch(/Too many failed attempts/);
    });

    it('does not reveal whether an email exists on password reset', async () => {
      const exists = await t.request('POST', '/auth/reset-password-request', { body: { tenantId: A.tenant.slug, email: A.email } });
      const missing = await t.request('POST', '/auth/reset-password-request', { body: { tenantId: A.tenant.slug, email: 'nobody@example.com' } });
      expect(exists.status).toBe(200);
      expect(missing.body.data).toEqual(exists.body.data);
    });
  });

  describe('billing integrity', () => {
    it('demo data never upgrades the subscription and can only be seeded once', async () => {
      const s = await t.signup();
      expect((await t.request('POST', '/tenants/seed-demo', { token: s.token })).status).toBe(201);
      const sub = await t.request('GET', '/tenants/subscription', { token: s.token });
      expect(sub.body.data.plan).toBe('FREE');
      expect(sub.body.data.status).toBe('TRIAL');
      expect((await t.request('POST', '/tenants/seed-demo', { token: s.token })).status).toBe(409);
    });

    it('rejects unsigned Stripe webhooks', async () => {
      const res = await t.request('POST', '/stripe/webhook', { body: { type: 'checkout.session.completed' } });
      expect([400, 503]).toContain(res.status);
    });
  });

  describe('settings safety', () => {
    it('refuses an IP allow-list that would lock the admin out', async () => {
      const res = await t.request('PATCH', '/tenants/settings', { token: A.token, ip: '203.0.113.5', body: { whitelistedIps: ['198.51.100.0/24'] } });
      expect(res.status).toBe(400);
    });

    it('enforces the IP allow-list once saved', async () => {
      const s = await t.signup();
      const ip = '203.0.113.7';
      expect((await t.request('PATCH', '/tenants/settings', { token: s.token, ip, body: { whitelistedIps: ['203.0.113.0/24'] } })).status).toBe(200);
      expect((await t.request('GET', '/employees', { token: s.token, ip })).status).toBe(200);
      expect((await t.request('GET', '/employees', { token: s.token, ip: '198.51.100.9' })).status).toBe(403);
    });

    it('only accepts genuine Slack webhook URLs (SSRF protection)', async () => {
      const res = await t.request('PATCH', '/tenants/settings', { token: A.token, body: { slackWebhookUrl: 'http://169.254.169.254/latest/meta-data' } });
      expect(res.status).toBe(400);
    });
  });

  describe('uploads', () => {
    it('rejects files whose content is not an allowed type, whatever the extension', async () => {
      const form = multipart({ title: 'Totally a PDF', type: 'ID' }, { field: 'file', filename: 'id.pdf', content: Buffer.from('MZ\x90\x00 this is an exe'), type: 'application/pdf' });
      const res = await t.request('POST', '/documents/upload', { token: A.token, ...form });
      expect(res.status).toBe(400);
    });

    it('stores documents privately and only lets the owner or an admin download them', async () => {
      const form = multipart({ title: 'Passport', type: 'ID' }, { field: 'file', filename: 'passport.pdf', content: FAKE_PDF, type: 'application/pdf' });
      const up = await t.request('POST', '/documents/upload', { token: A.token, ...form });
      expect(up.status).toBe(201);
      const id = up.body.data.id;

      const mine = await t.request('GET', `/documents/${id}/download`, { token: A.token });
      expect(mine.status).toBe(200);
      expect(mine.headers['content-type']).toContain('application/pdf');
      expect(mine.raw.subarray(0, 5).toString()).toBe('%PDF-');

      expect((await t.request('GET', `/documents/${id}/download`, { token: B.token })).status).toBe(404);
    });
  });

  it('returns a consistent error envelope with a request id', async () => {
    const res = await t.request('GET', '/employees/not-a-uuid', { token: A.token });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, statusCode: 400 });
    expect(res.body.requestId).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });
});

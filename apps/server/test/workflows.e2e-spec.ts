/**
 * End-to-end business workflows across modules, run against a real database.
 */
import { TokenService } from '../src/common/auth/token.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FAKE_PDF, multipart, PASSWORD, TestClient, unique } from './helpers';
import { createHmac } from 'crypto';

/** Next Monday..Tuesday at least a week ahead, as YYYY-MM-DD. */
function upcomingWeekdays(weeksAhead = 1): [string, string] {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7 + ((8 - d.getUTCDay()) % 7));
  const start = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 1);
  return [start, d.toISOString().slice(0, 10)];
}

describe('Workflows', () => {
  let t: TestClient;
  let tokens: TokenService;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<TestClient['signup']>>;
  let manager: { token: string; employeeId: string };
  let employee: { token: string; employeeId: string; email: string };

  async function member(role: 'EMPLOYEE' | 'MANAGER') {
    const email = `${role.toLowerCase()}-${unique()}@example.com`;
    const invite = await t.request('POST', '/auth/invite', { token: admin.token, body: { email, name: `${role} Person`, role } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: invite.body.data.userId }, include: { employee: true } });
    await t.request('POST', '/auth/accept-invite', { body: { token: tokens.sign('invite', { sub: user.id, ver: user.tokenVersion }), password: PASSWORD } });
    const login = await t.request('POST', '/auth/login', { body: { tenantId: admin.tenant.slug, email, password: PASSWORD } });
    return { token: login.body.data.accessToken as string, employeeId: user.employee!.id, email };
  }

  beforeAll(async () => {
    t = await TestClient.create();
    tokens = t.app.get(TokenService);
    prisma = t.app.get(PrismaService);
    admin = await t.signup();
    manager = await member('MANAGER');
    employee = await member('EMPLOYEE');
    const setManager = await t.request('PATCH', `/employees/${employee.employeeId}`, { token: admin.token, body: { managerId: manager.employeeId } });
    expect(setManager.status).toBe(200);
  });

  afterAll(() => t.close());

  describe('employees', () => {
    it('shows colleagues directory fields only to non-admins', async () => {
      const list = await t.request('GET', '/employees', { token: employee.token });
      expect(list.status).toBe(200);
      expect(list.body.data.items[0]).not.toHaveProperty('phone');
      const adminList = await t.request('GET', '/employees', { token: admin.token });
      expect(adminList.body.data.items[0]).toHaveProperty('employmentType');
    });

    it('rejects reporting cycles', async () => {
      const res = await t.request('PATCH', `/employees/${manager.employeeId}`, { token: admin.token, body: { managerId: employee.employeeId } });
      expect(res.status).toBe(400);
    });

    it('prevents removing the last admin', async () => {
      const me = await t.request('GET', '/employees/me', { token: admin.token });
      const res = await t.request('PATCH', `/employees/${me.body.data.id}/role`, { token: admin.token, body: { role: 'EMPLOYEE' }, headers: await t.stepUp(admin.token) });
      expect(res.status).toBe(403); // cannot change own role
    });
  });

  describe('leave', () => {
    let leaveId: string;
    const [start, end] = upcomingWeekdays();

    it('employee requests leave; working days are computed server-side', async () => {
      const res = await t.request('POST', '/leave-requests', { token: employee.token, body: { type: 'annual', startDate: start, endDate: end, reason: 'Trip' } });
      expect(res.status).toBe(201);
      expect(res.body.data.days).toBe(2);
      expect(res.body.data.status).toBe('PENDING');
      leaveId = res.body.data.id;
    });

    it('rejects overlapping requests and ranges beyond the balance', async () => {
      expect((await t.request('POST', '/leave-requests', { token: employee.token, body: { type: 'ANNUAL', startDate: start, endDate: start } })).status).toBe(409);
      const year = new Date().getUTCFullYear();
      const tooLong = await t.request('POST', '/leave-requests', { token: employee.token, body: { type: 'CASUAL', startDate: `${year}-12-01`, endDate: `${year}-12-31` } });
      expect([400]).toContain(tooLong.status);
    });

    it('pending leave counts against the balance', async () => {
      const res = await t.request('GET', '/leave-requests/balance', { token: employee.token });
      const annual = res.body.data.find((b: any) => b.type === 'ANNUAL');
      expect(annual.pending).toBe(2);
      expect(annual.remaining).toBe(annual.quota - 2);
    });

    it('employees cannot approve; the direct manager can, exactly once', async () => {
      expect((await t.request('PATCH', `/leave-requests/${leaveId}/status`, { token: employee.token, body: { status: 'APPROVED' } })).status).toBe(403);
      const team = await t.request('GET', '/leave-requests?scope=team', { token: manager.token });
      expect(team.body.data.items.map((l: any) => l.id)).toContain(leaveId);

      const ok = await t.request('PATCH', `/leave-requests/${leaveId}/status`, { token: manager.token, body: { status: 'APPROVED', note: 'Enjoy' } });
      expect(ok.status).toBe(200);
      expect(ok.body.data.status).toBe('APPROVED');
      expect((await t.request('PATCH', `/leave-requests/${leaveId}/status`, { token: admin.token, body: { status: 'REJECTED' } })).status).toBe(409);
    });

    it('snapshots multi-step approvals and maintains an idempotent ledger statement', async () => {
      const rules = await t.request('PUT', '/leave-approval-rules', {
        token: admin.token,
        body: {
          type: 'ANNUAL',
          rules: [
            { step: 1, approverKind: 'DIRECT_MANAGER' },
            { step: 2, approverKind: 'ROLE', approverRole: 'ADMIN' },
          ],
        },
      });
      expect(rules.status).toBe(200);
      const [secondStart, secondEnd] = upcomingWeekdays(3);
      const request = await t.request('POST', '/leave-requests', {
        token: employee.token,
        body: { type: 'ANNUAL', startDate: secondStart, endDate: secondEnd, requestKey: '00000000-0000-4000-8000-000000000001' },
      });
      expect(request.status).toBe(201);
      const retry = await t.request('POST', '/leave-requests', {
        token: employee.token,
        body: { type: 'ANNUAL', startDate: secondStart, endDate: secondEnd, requestKey: '00000000-0000-4000-8000-000000000001' },
      });
      expect(retry.body.data.id).toBe(request.body.data.id);

      const managerStep = await t.request('PATCH', `/leave-requests/${request.body.data.id}/status`, { token: manager.token, body: { status: 'APPROVED' } });
      expect(managerStep.status).toBe(200);
      expect(managerStep.body.data.status).toBe('PENDING');
      const finalStep = await t.request('PATCH', `/leave-requests/${request.body.data.id}/status`, { token: admin.token, body: { status: 'APPROVED' } });
      expect(finalStep.status).toBe(200);
      expect(finalStep.body.data.status).toBe('APPROVED');

      const statement = await t.request('GET', `/leave-balance-ledger?employeeId=${employee.employeeId}&type=ANNUAL`, { token: admin.token });
      expect(statement.status).toBe(200);
      expect(statement.body.data.map((entry: any) => entry.event)).toEqual(expect.arrayContaining(['RESERVATION', 'RELEASE', 'CONSUMPTION']));

      const adjustment = { employeeId: employee.employeeId, type: 'ANNUAL', year: new Date().getUTCFullYear(), days: 1, reason: 'Verified migration correction', adjustmentKey: '00000000-0000-4000-8000-000000000002' };
      const firstAdjustment = await t.request('POST', '/leave-balance-adjustments', { token: admin.token, body: adjustment });
      const repeatedAdjustment = await t.request('POST', '/leave-balance-adjustments', { token: admin.token, body: adjustment });
      expect(firstAdjustment.status).toBe(201);
      expect(repeatedAdjustment.body.data.id).toBe(firstAdjustment.body.data.id);
    });
  });

  describe('attendance', () => {
    it('clock in once per day, then clock out', async () => {
      expect((await t.request('POST', '/attendance/clock-in', { token: employee.token })).status).toBe(201);
      expect((await t.request('POST', '/attendance/clock-in', { token: employee.token })).status).toBe(409);
      const out = await t.request('POST', '/attendance/clock-out', { token: employee.token });
      expect(out.status).toBe(201);
      expect(out.body.data.workMinutes).toBeGreaterThanOrEqual(0);
    });

    it('records attendance against the caller, not another employee', async () => {
      const mine = await t.request('GET', '/attendance/me', { token: employee.token });
      expect(mine.body.data.today.employeeId).toBe(employee.employeeId);
      const managerView = await t.request('GET', '/attendance/me', { token: manager.token });
      expect(managerView.body.data.today).toBeNull();
    });

    it('managers see a roster of their team', async () => {
      const roster = await t.request('GET', '/attendance/roster', { token: manager.token });
      expect(roster.status).toBe(200);
      expect(roster.body.data.rows.map((r: any) => r.employee.id)).toEqual([employee.employeeId]);
    });
  });

  describe('payroll', () => {
    const last = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1));
    const period = { month: last.getUTCMonth() + 1, year: last.getUTCFullYear() };

    it('draft → finalize lifecycle with exact money maths', async () => {
      const stepUp = await t.stepUp(admin.token);
      const salary = await t.request('PUT', `/payroll/salaries/${employee.employeeId}`, {
        token: admin.token,
        headers: stepUp,
        body: { baseSalary: 30000, allowances: 10000, deductions: 200, monthlyTds: 1500, pfEnabled: true },
      });
      expect(salary.status).toBe(200);

      const run = await t.request('POST', '/payroll/runs/generate', { token: admin.token, body: period });
      expect(run.status).toBe(201);
      const slip = run.body.data.payslips.find((p: any) => p.employeeId === employee.employeeId);
      // PF = 12% of min(30000, 15000) = 1800; net = 40000 - (1800 + 1500 + 200) = 36500
      expect(slip).toMatchObject({ grossPay: 40000, pfDeduction: 1800, tdsDeduction: 1500, deductions: 3500, netPay: 36500, status: 'DRAFT' });

      expect((await t.request('GET', '/payroll/my-payslips', { token: employee.token })).body.data).toHaveLength(0); // drafts are hidden

      expect((await t.request('POST', '/payroll/runs/finalize', { token: admin.token, body: period })).status).toBe(403); // sensitive: needs step-up
      expect((await t.request('POST', '/payroll/runs/finalize', { token: admin.token, body: period, headers: stepUp })).status).toBe(201);
      expect((await t.request('POST', '/payroll/runs/generate', { token: admin.token, body: period })).status).toBe(409);

      const mine = await t.request('GET', '/payroll/my-payslips', { token: employee.token });
      expect(mine.body.data).toHaveLength(1);
      const pdf = await t.request('GET', `/payroll/payslips/${mine.body.data[0].id}/pdf`, { token: employee.token });
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect(pdf.raw.subarray(0, 5).toString()).toBe('%PDF-');

      expect((await t.request('GET', `/payroll/payslips/${mine.body.data[0].id}/pdf`, { token: manager.token })).status).toBe(403);
    });
  });

  describe('performance', () => {
    it('DRAFT → SELF_SUBMITTED → COMPLETED with the manager as reviewer', async () => {
      const cycle = await t.request('POST', '/performance/cycle', { token: admin.token, body: { cycleName: `H2 ${unique()}` } });
      expect(cycle.status).toBe(201);
      const [review] = (await t.request('GET', '/performance/me', { token: employee.token })).body.data;
      expect(review.reviewerId).toBe(manager.employeeId);

      expect((await t.request('PATCH', `/performance/${review.id}/manager`, { token: manager.token, body: { managerRating: 4, comments: 'Early' } })).status).toBe(409);
      expect((await t.request('PATCH', `/performance/${review.id}/self`, { token: employee.token, body: { selfRating: 4, comments: 'Shipped a lot' } })).status).toBe(200);
      const done = await t.request('PATCH', `/performance/${review.id}/manager`, { token: manager.token, body: { managerRating: 5, comments: 'Great half' } });
      expect(done.status).toBe(200);
      expect(done.body.data.status).toBe('COMPLETED');
    });
  });

  describe('hiring', () => {
    it('public application → pipeline → interview scheduling', async () => {
      const job = await t.request('POST', '/hiring/jobs', { token: admin.token, body: { title: 'Backend Engineer', department: 'Engineering', description: 'Own APIs, databases and reliability for our platform.' } });
      const email = `cand-${unique()}@example.com`;
      const apply = () =>
        t.request('POST', `/careers/${admin.tenant.slug}/jobs/${job.body.data.id}/apply`, multipart({ candidateName: 'Carl Candidate', candidateEmail: email, consent: 'true' }, { field: 'resume', filename: 'cv.pdf', content: FAKE_PDF, type: 'application/pdf' }));
      const applied = await apply();
      expect(applied.status).toBe(201);
      expect((await apply()).status).toBe(409); // duplicate application

      const apps = await t.request('GET', `/hiring/applications?jobId=${job.body.data.id}`, { token: manager.token });
      expect(apps.body.data.items).toHaveLength(1);
      const id = apps.body.data.items[0].id;

      const resume = await t.request('GET', `/hiring/applications/${id}/resume`, { token: manager.token });
      expect(resume.status).toBe(200);

      const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
      const interview = await t.request('POST', `/hiring/applications/${id}/schedule-interview`, { token: manager.token, body: { startsAt, durationMinutes: 60, location: 'Room 7' } });
      expect(interview.status).toBe(201);
      expect(interview.body.data.status).toBe('INTERVIEW');
      expect(interview.body.data.interviewDurationMinutes).toBe(60);
      expect(interview.body.data.interviewLocation).toBe('Room 7');
      expect(interview.body.data.calendarUrl).toContain('calendar.google.com');

      const stages = (await t.request('GET', '/hiring/stages', { token: manager.token })).body.data;
      const offered = stages.find((stage: any) => stage.category === 'OFFERED');
      const interviewStage = stages.find((stage: any) => stage.category === 'INTERVIEW');
      expect((await t.request('POST', `/hiring/applications/${id}/move`, { token: manager.token, body: { stageId: offered.id } })).status).toBe(409);
      expect((await t.request('POST', `/hiring/applications/${id}/move`, { token: admin.token, body: { stageId: offered.id } })).status).toBe(201);
      expect((await t.request('POST', `/hiring/applications/${id}/move`, { token: admin.token, body: { stageId: interviewStage.id } })).status).toBe(409);
      expect((await t.request('POST', `/hiring/applications/${id}/move`, { token: admin.token, body: { stageId: interviewStage.id, note: 'Re-opened after compensation review' } })).status).toBe(201);

      const reordered = [...stages].reverse().map((stage: any) => stage.id);
      const reorder = await t.request('PUT', '/hiring/stages/reorder', { token: admin.token, body: { stageIds: reordered } });
      expect(reorder.status).toBe(200);
      expect(reorder.body.data.map((stage: any) => stage.id)).toEqual(reordered);

      const timeline = await t.request('GET', `/hiring/applications/${id}/timeline`, { token: manager.token });
      expect(timeline.body.data.map((event: any) => event.type)).toEqual(expect.arrayContaining(['APPLICATION_SUBMITTED', 'INTERVIEW_SCHEDULED', 'STAGE_ROLLED_BACK']));
    });

    it('processes an assessment callback idempotently at the documented path', async () => {
      const job = await t.request('POST', '/hiring/jobs', { token: admin.token, body: { title: 'QA Engineer', department: 'Engineering', description: 'Own automated product quality and release confidence.' } });
      const applied = await t.request('POST', `/careers/${admin.tenant.slug}/jobs/${job.body.data.id}/apply`, multipart({ candidateName: 'Alex Assessed', candidateEmail: `assessed-${unique()}@example.com`, consent: 'true' }, { field: 'resume', filename: 'cv.pdf', content: FAKE_PDF, type: 'application/pdf' }));
      const integration = await t.request('POST', '/hiring/assessment-integrations', { token: admin.token, body: { provider: `TEST_${unique().toUpperCase()}`, displayName: 'Test Provider' } });
      const externalId = `assessment-${unique()}`;
      // Linking needs hiring.assessments.manage (recruiters/admins), which managers do not hold.
      const managerLink = await t.request('POST', `/hiring/applications/${applied.body.data.applicationId}/assessments`, { token: manager.token, body: { integrationId: integration.body.data.id, externalId } });
      expect(managerLink.status).toBe(403);
      const linked = await t.request('POST', `/hiring/applications/${applied.body.data.applicationId}/assessments`, { token: admin.token, body: { integrationId: integration.body.data.id, externalId } });
      expect(linked.status).toBe(201);

      const payload = Buffer.from(JSON.stringify({ eventId: `event-${unique()}`, externalId, status: 'COMPLETED', score: 88, recommendation: 'ADVANCE' }));
      const signature = createHmac('sha256', integration.body.data.webhookSecret).update(payload).digest('hex');
      const callback = () => t.request('POST', `/hiring/assessment-integrations/${integration.body.data.id}/webhook`, { payload, headers: { 'content-type': 'application/json', 'x-assessment-signature': signature } });
      expect((await callback()).body.data).toEqual({ received: true, duplicate: false });
      expect((await callback()).body.data).toEqual({ received: true, duplicate: true });
    });

    it('derives stage durations and offer acceptance from trustworthy event history', async () => {
      const metricsTenant = await t.signup(`Metrics ${unique()}`);
      const job = await t.request('POST', '/hiring/jobs', {
        token: metricsTenant.token,
        body: { title: 'Data Engineer', department: 'Engineering', description: 'Build trustworthy recruiting data pipelines.' },
      });
      const stages = (await t.request('GET', '/hiring/stages', { token: metricsTenant.token })).body.data;
      const appliedStage = stages.find((stage: any) => stage.category === 'APPLIED');
      const offeredStage = stages.find((stage: any) => stage.category === 'OFFERED');
      const hiredStage = stages.find((stage: any) => stage.category === 'HIRED');
      const rejectedStage = stages.find((stage: any) => stage.category === 'REJECTED');
      const customStage = (
        await t.request('POST', '/hiring/stages', {
          token: metricsTenant.token,
          body: { key: `TECH_${unique().toUpperCase()}`, name: 'Technical screen', category: 'SCREENING', position: 25 },
        })
      ).body.data;
      const day = (value: number) => new Date(`2026-01-0${value}T00:00:00.000Z`);

      await prisma.application.create({
        data: {
          tenantId: metricsTenant.tenant.id,
          jobId: job.body.data.id,
          stageId: rejectedStage.id,
          candidateName: 'Rejected Offer',
          candidateEmail: `rejected-${unique()}@example.test`,
          status: 'REJECTED',
          createdAt: day(1),
          events: {
            create: [
              { tenantId: metricsTenant.tenant.id, type: 'APPLICATION_SUBMITTED', createdAt: day(1), metadata: { stageId: appliedStage.id, stageName: appliedStage.name } },
              { tenantId: metricsTenant.tenant.id, type: 'STAGE_CHANGED', createdAt: day(3), metadata: { toStatus: 'SCREENING', toStageId: customStage.id, toStageName: customStage.name } },
              { tenantId: metricsTenant.tenant.id, type: 'STAGE_CHANGED', createdAt: day(6), metadata: { toStatus: 'OFFERED', toStageId: offeredStage.id, toStageName: offeredStage.name } },
              { tenantId: metricsTenant.tenant.id, type: 'STAGE_CHANGED', createdAt: day(8), metadata: { toStatus: 'REJECTED', toStageId: rejectedStage.id, toStageName: rejectedStage.name } },
            ],
          },
        },
      });
      await prisma.application.create({
        data: {
          tenantId: metricsTenant.tenant.id,
          jobId: job.body.data.id,
          stageId: hiredStage.id,
          candidateName: 'Accepted Offer',
          candidateEmail: `hired-${unique()}@example.test`,
          status: 'HIRED',
          createdAt: day(1),
          events: {
            create: [
              { tenantId: metricsTenant.tenant.id, type: 'APPLICATION_SUBMITTED', createdAt: day(1), metadata: { stageId: appliedStage.id, stageName: appliedStage.name } },
              { tenantId: metricsTenant.tenant.id, type: 'STAGE_CHANGED', createdAt: day(2), metadata: { toStatus: 'OFFERED', toStageId: offeredStage.id, toStageName: offeredStage.name } },
              { tenantId: metricsTenant.tenant.id, type: 'STAGE_CHANGED', createdAt: day(4), metadata: { toStatus: 'HIRED', toStageId: hiredStage.id, toStageName: hiredStage.name } },
            ],
          },
        },
      });
      await prisma.application.create({
        data: {
          tenantId: metricsTenant.tenant.id,
          jobId: job.body.data.id,
          stageId: appliedStage.id,
          candidateName: 'Legacy Candidate',
          candidateEmail: `legacy-${unique()}@example.test`,
          status: 'APPLIED',
          createdAt: day(1),
        },
      });

      const response = await t.request('GET', '/analytics/hiring', { token: metricsTenant.token });
      expect(response.status).toBe(200);
      expect(response.body.data.offerAcceptanceRate).toBe(50);
      expect(response.body.data.timeToHire).toEqual({ avgDays: 3, medianDays: 3 });
      expect(response.body.data.timePerStage).toEqual(expect.arrayContaining([
        { stage: appliedStage.name, medianDays: 1.5 },
        { stage: customStage.name, medianDays: 3 },
        { stage: offeredStage.name, medianDays: 2 },
      ]));
      expect(response.body.data.sourceOfHire[0].applied).toBe(3);
    });

    it('closed jobs stop accepting applications', async () => {
      const job = await t.request('POST', '/hiring/jobs', { token: admin.token, body: { title: 'Temp role', department: 'Ops', description: 'A short-term operations role for the season.' } });
      await t.request('PATCH', `/hiring/jobs/${job.body.data.id}`, { token: admin.token, body: { status: 'CLOSED' } });
      const res = await t.request('POST', `/careers/${admin.tenant.slug}/jobs/${job.body.data.id}/apply`, multipart({ candidateName: 'Late Larry', candidateEmail: `l-${unique()}@example.com`, consent: 'true' }, { field: 'resume', filename: 'cv.pdf', content: FAKE_PDF, type: 'application/pdf' }));
      expect(res.status).toBe(404);
    });
  });

  describe('offboarding and data protection', () => {
    it('offboarding revokes access immediately; erasure removes personal data but keeps payslips', async () => {
      const leaver = await member('EMPLOYEE');
      const login = await prisma.user.findFirstOrThrow({ where: { employee: { id: leaver.employeeId } } });
      const refresh = tokens.sign('refresh', { sub: login.id, ver: login.tokenVersion, jti: unique() });

      const export1 = await t.request('GET', '/gdpr/export', { token: leaver.token });
      expect(export1.status).toBe(200);
      expect(JSON.parse(export1.raw.toString()).subject.email).toBe(leaver.email);

      const stepUp = await t.stepUp(admin.token);
      expect((await t.request('POST', `/gdpr/employees/${leaver.employeeId}/erase`, { token: admin.token, headers: stepUp })).status).toBe(400); // must offboard first
      expect((await t.request('POST', `/employees/${leaver.employeeId}/offboard`, { token: admin.token, body: { exitDate: new Date().toISOString().slice(0, 10) } })).status).toBe(201);

      expect((await t.request('POST', '/auth/refresh', { body: { refreshToken: refresh } })).status).toBe(401);
      expect((await t.request('POST', '/auth/login', { body: { tenantId: admin.tenant.slug, email: leaver.email, password: PASSWORD } })).status).toBe(401);

      expect((await t.request('POST', `/gdpr/employees/${leaver.employeeId}/erase`, { token: admin.token, headers: stepUp })).status).toBe(201);
      const erased = await prisma.employee.findUniqueOrThrow({ where: { id: leaver.employeeId } });
      expect(erased.firstName).toBe('Former');
      expect(erased.email).not.toBe(leaver.email);
    });
  });

  it('writes an audit trail for mutations', async () => {
    const logs = await t.request('GET', '/audit?pageSize=100', { token: admin.token });
    const actions = logs.body.data.items.map((l: any) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['PAYROLL_FINALIZED', 'SALARY_CREATED', 'EMPLOYEE_OFFBOARDED', 'INVITE']));
  });
});

import { HiringInterviewService } from './hiring-interview.service';

const user = { userId: 'user-1', tenantId: 'tenant-1', role: 'MANAGER', email: 'manager@example.test', name: 'Manager', employeeId: null } as const;

describe('HiringInterviewService', () => {
  it('re-arms reminders and persists duration/location when rescheduling', async () => {
    const app = {
      id: 'application-1', tenantId: user.tenantId, status: 'INTERVIEW', stageId: 'interview-stage', stage: { id: 'interview-stage', name: 'Interview' },
      candidateName: 'Casey', candidateEmail: 'casey@example.test', interviewScheduleVersion: 4,
      job: { title: 'Engineer' }, tenant: { name: 'Acme' },
    };
    const tx = {
      application: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...app, interviewScheduleVersion: 5 }),
      },
      applicationEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      hiringOutboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      application: { findFirst: jest.fn().mockResolvedValue(app) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'interviewer-1', name: 'Interviewer', email: user.email, isActive: true }) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const workflow = { defaultStage: jest.fn().mockResolvedValue({ id: 'interview-stage', name: 'Interview' }) };
    const outbox = { enqueueEmail: jest.fn().mockResolvedValue({}) };
    const service = new HiringInterviewService(prisma as any, workflow as any, outbox as any);
    await service.schedule(user as any, app.id, { startsAt: '2030-01-02T10:00:00.000Z', durationMinutes: 75, location: 'Room 9', isReschedule: true });

    expect(tx.application.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ interviewDurationMinutes: 75, interviewLocation: 'Room 9', interviewScheduleVersion: 5, interviewReminderSentAt: null }),
    }));
    expect(tx.applicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'INTERVIEW_RESCHEDULED' }) }));
    expect(outbox.enqueueEmail).toHaveBeenCalledTimes(2);
  });
});

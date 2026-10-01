import { HiringScheduler } from './hiring.scheduler';

const application = {
  id: 'application-1', tenantId: 'tenant-1', candidateName: 'Casey', candidateEmail: 'casey@example.test',
  status: 'INTERVIEW', interviewAt: new Date('2030-01-01T10:00:00.000Z'), interviewerEmail: 'manager@example.test',
  interviewDurationMinutes: 60, interviewLocation: 'Room 7', interviewScheduleVersion: 3, interviewReminderSentAt: null,
  job: { title: 'Engineer' }, tenant: { name: 'Acme' },
};

describe('HiringScheduler', () => {
  it('lets only one of two workers claim and enqueue the same reminder', async () => {
    let claimed = false;
    const tx = {
      application: { updateMany: jest.fn().mockImplementation(() => claimed ? { count: 0 } : (claimed = true, { count: 1 })) },
      applicationEvent: { create: jest.fn().mockResolvedValue({}) },
      hiringOutboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      application: { findMany: jest.fn().mockResolvedValue([application]) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Manager', email: application.interviewerEmail, isActive: true }) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const outbox = { enqueueEmail: jest.fn().mockResolvedValue({}) };
    const first = new HiringScheduler(prisma as any, outbox as any);
    const second = new HiringScheduler(prisma as any, outbox as any);
    await Promise.all([first.queueInterviewReminders(), second.queueInterviewReminders()]);

    expect(outbox.enqueueEmail).toHaveBeenCalledTimes(2);
    expect(outbox.enqueueEmail).toHaveBeenCalledWith(tx, expect.objectContaining({ eventKey: 'interview-reminder:application-1:v3:candidate' }));
    expect(outbox.enqueueEmail).toHaveBeenCalledWith(tx, expect.objectContaining({ eventKey: 'interview-reminder:application-1:v3:interviewer' }));
    expect(tx.applicationEvent.create).toHaveBeenCalledTimes(1);
  });

  it('cleans up its initial and recurring timers on shutdown', () => {
    jest.useFakeTimers();
    const scheduler = new HiringScheduler({} as any, {} as any);
    scheduler.onModuleInit();
    expect(jest.getTimerCount()).toBe(2);
    scheduler.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});

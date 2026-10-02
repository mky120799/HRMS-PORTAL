import { ConflictException } from '@nestjs/common';
import { HiringWorkflowService } from './hiring-workflow.service';

const admin = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-1',
  role: 'ADMIN',
  email: 'admin@example.test',
  name: 'Admin',
  employeeId: null,
} as const;
const manager = {
  ...admin,
  userId: '44444444-4444-4444-8444-444444444444',
  role: 'MANAGER',
} as const;

const stage = (
  overrides: Partial<
    Record<'id' | 'key' | 'name' | 'category' | 'position' | 'isActive', any>
  > = {},
) => ({
  id: '22222222-2222-4222-8222-222222222222',
  key: 'TECHNICAL',
  name: 'Technical interview',
  category: 'INTERVIEW',
  position: 30,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

describe('HiringWorkflowService', () => {
  function serviceFor(
    options: {
      current?: ReturnType<typeof stage>;
      target?: ReturnType<typeof stage>;
      updateCount?: number;
    } = {},
  ) {
    const current =
      options.current ??
      stage({
        id: '33333333-3333-4333-8333-333333333333',
        key: 'SCREENING',
        name: 'Screening',
        category: 'SCREENING',
        position: 20,
      });
    const target = options.target ?? stage();
    const application = {
      id: 'application-1',
      tenantId: admin.tenantId,
      status: current.category,
      stageId: current.id,
      stage: current,
      candidateName: 'Candidate',
      candidateEmail: 'candidate@example.test',
      job: { title: 'Engineer' },
      tenant: { name: 'Acme' },
    };
    const tx = {
      application: {
        findFirst: jest.fn().mockResolvedValue(application),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: options.updateCount ?? 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({
            ...application,
            status: target.category,
            stage: target,
          }),
      },
      applicationEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
      hiringStage: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        count: jest.fn(),
      },
    };
    const prisma = {
      hiringStage: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(target),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      $transaction: jest.fn(
        (operation: ((client: typeof tx) => unknown) | unknown[]) =>
          Array.isArray(operation) ? Promise.all(operation) : operation(tx),
      ),
    };
    const outbox = {
      enqueueEmail: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };
    return {
      service: new HiringWorkflowService(prisma as any, outbox as any),
      prisma,
      tx,
    };
  }

  it('allows a manager to move forward through an active custom stage', async () => {
    const { service, tx } = serviceFor();
    await expect(
      service.move(manager as any, 'application-1', {
        stageId: stage().id,
        note: 'Passed phone screen',
      }),
    ).resolves.toMatchObject({ status: 'INTERVIEW' });
    expect(tx.application.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stageId: stage().id, status: 'INTERVIEW' },
      }),
    );
    expect(tx.applicationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'STAGE_CHANGED',
          actorUserId: manager.userId,
        }),
      }),
    );
  });

  it('prevents a manager moving backward between custom stages', async () => {
    const current = stage({ id: 'current', name: 'Panel', position: 35 });
    const target = stage({ id: 'target', name: 'Technical', position: 30 });
    const { service, tx } = serviceFor({ current, target });
    await expect(
      service.move(manager as any, 'application-1', {
        stageId: target.id,
        note: 'Retry',
      }),
    ).rejects.toThrow('Only admins');
    expect(tx.application.updateMany).not.toHaveBeenCalled();
  });

  it.each(['OFFERED', 'HIRED'])(
    'prevents a manager moving to %s',
    async (category) => {
      const target = stage({
        id: `target-${category}`,
        key: category,
        name: category,
        category,
        position: category === 'OFFERED' ? 40 : 50,
      });
      const current = stage({
        id: 'current',
        category: category === 'OFFERED' ? 'INTERVIEW' : 'OFFERED',
        position: category === 'OFFERED' ? 30 : 40,
      });
      const { service } = serviceFor({ current, target });
      await expect(
        service.move(manager as any, 'application-1', { stageId: target.id }),
      ).rejects.toThrow('Only admins');
    },
  );

  it('allows a manager to reject even when the rejected stage is ordered earlier', async () => {
    const current = stage({
      id: 'current',
      category: 'INTERVIEW',
      position: 30,
    });
    const target = stage({
      id: 'rejected',
      key: 'REJECTED',
      name: 'Rejected',
      category: 'REJECTED',
      position: 5,
    });
    const { service } = serviceFor({ current, target });
    await expect(
      service.move(manager as any, 'application-1', { stageId: target.id }),
    ).resolves.toMatchObject({ status: 'REJECTED' });
  });

  it('allows an admin rollback only with a reason and records it', async () => {
    const current = stage({ id: 'current', name: 'Panel', position: 35 });
    const target = stage({ id: 'target', name: 'Technical', position: 30 });
    const withoutReason = serviceFor({ current, target });
    await expect(
      withoutReason.service.move(admin as any, 'application-1', {
        stageId: target.id,
      }),
    ).rejects.toThrow('reason is required');

    const withReason = serviceFor({ current, target });
    await withReason.service.move(admin as any, 'application-1', {
      stageId: target.id,
      note: 'Panel must be repeated',
    });
    expect(withReason.tx.applicationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'STAGE_ROLLED_BACK',
          note: 'Panel must be repeated',
        }),
      }),
    );
    expect(withReason.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'APPLICATION_STAGE_ROLLED_BACK',
        }),
      }),
    );
  });

  it('rejects an invalid category jump', async () => {
    const current = stage({ id: 'current', category: 'APPLIED', position: 10 });
    const target = stage({ id: 'target', category: 'OFFERED', position: 40 });
    const { service, tx } = serviceFor({ current, target });
    await expect(
      service.move(admin as any, 'application-1', { stageId: target.id }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.application.updateMany).not.toHaveBeenCalled();
  });

  it('detects concurrent application moves using an optimistic update', async () => {
    const { service, tx } = serviceFor({ updateCount: 0 });
    await expect(
      service.move(admin as any, 'application-1', { stageId: stage().id }),
    ).rejects.toThrow('changed before');
    expect(tx.applicationEvent.create).not.toHaveBeenCalled();
  });

  it('prevents deactivating the last active stage in a required category', async () => {
    const { service, tx } = serviceFor();
    tx.hiringStage.findFirst.mockResolvedValue({
      id: 'stage-1',
      category: 'INTERVIEW',
      isActive: true,
    });
    tx.hiringStage.count.mockResolvedValue(0);
    await expect(
      service.updateStage(admin as any, 'stage-1', { isActive: false }),
    ).rejects.toThrow('At least one active interview stage');
    expect(tx.hiringStage.updateMany).not.toHaveBeenCalled();
  });

  it('reorders the complete stage list atomically with its audit record', async () => {
    const { service, prisma, tx } = serviceFor();
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    tx.hiringStage.findMany.mockResolvedValueOnce(ids.map((id) => ({ id })));
    prisma.hiringStage.findMany.mockResolvedValueOnce(
      ids.map((id, i) => stage({ id, position: (i + 1) * 10 })),
    );
    await service.reorderStages(admin as any, { stageIds: ids });
    expect(tx.hiringStage.update).toHaveBeenNthCalledWith(1, {
      where: { id: ids[0] },
      data: { position: 10 },
    });
    expect(tx.hiringStage.update).toHaveBeenNthCalledWith(2, {
      where: { id: ids[1] },
      data: { position: 20 },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

import { ConflictException } from '@nestjs/common';
import { HiringWorkflowService } from './hiring-workflow.service';

const user = { userId: '11111111-1111-4111-8111-111111111111', tenantId: 'tenant-1', role: 'ADMIN', email: 'admin@example.test', name: 'Admin', employeeId: null } as const;
const target = { id: '22222222-2222-4222-8222-222222222222', key: 'TECHNICAL', name: 'Technical interview', category: 'INTERVIEW', position: 30, isActive: true, createdAt: new Date(), updatedAt: new Date() };

describe('HiringWorkflowService', () => {
  function serviceFor(currentStatus: string, currentStageId: string | null = '33333333-3333-4333-8333-333333333333') {
    const tx = {
      application: {
        findFirst: jest.fn().mockResolvedValue({ id: 'application-1', status: currentStatus, stageId: currentStageId }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'application-1', status: target.category, stage: target }),
      },
      applicationEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
    };
    const prisma = {
      hiringStage: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(target),
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return { service: new HiringWorkflowService(prisma as any, audit as any), prisma, tx };
  }

  it('moves an application only through an allowed category transition and writes its timeline event', async () => {
    const { service, tx } = serviceFor('SCREENING');
    await expect(service.move(user as any, 'application-1', { stageId: target.id, note: 'Passed phone screen' })).resolves.toMatchObject({ status: 'INTERVIEW' });
    expect(tx.application.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { stageId: target.id, status: 'INTERVIEW' } }));
    expect(tx.applicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'STAGE_CHANGED', actorUserId: user.userId }) }));
  });

  it('rejects invalid jumps, such as APPLIED directly to OFFERED', async () => {
    const { service, tx, prisma } = serviceFor('APPLIED');
    prisma.hiringStage.findFirst.mockResolvedValue({ ...target, category: 'OFFERED' });
    await expect(service.move(user as any, 'application-1', { stageId: target.id })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.application.updateMany).not.toHaveBeenCalled();
    expect(tx.applicationEvent.create).not.toHaveBeenCalled();
  });
});

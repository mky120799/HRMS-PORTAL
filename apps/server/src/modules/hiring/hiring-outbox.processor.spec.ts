import { HiringOutboxProcessor } from './hiring-outbox.processor';

const event = {
  id: 'outbox-1', tenantId: 'tenant-1', applicationId: 'application-1', eventKey: 'ai-screening:application-1:initial',
  type: 'HIRING_QUEUE', payload: { jobType: 'screen', data: { applicationId: 'application-1', tenantId: 'tenant-1' } },
  status: 'PENDING', attempts: 0, availableAt: new Date(), lockedAt: null, lastError: null, processedAt: null, createdAt: new Date(), updatedAt: new Date(),
};

describe('HiringOutboxProcessor', () => {
  function setup(publish = jest.fn().mockResolvedValue(undefined), item: Record<string, any> = event) {
    const prisma = {
      hiringOutboxEvent: {
        findMany: jest.fn().mockResolvedValue([item]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const rabbit = { publish };
    const processor = new HiringOutboxProcessor(prisma as any, { send: jest.fn() } as any, rabbit as any, { newApplication: jest.fn() } as any);
    jest.spyOn((processor as any).logger, 'warn').mockImplementation();
    jest.spyOn((processor as any).logger, 'error').mockImplementation();
    return { processor, prisma, rabbit };
  }

  it('retries a failed RabbitMQ publication with bounded backoff data', async () => {
    const { processor, prisma } = setup(jest.fn().mockRejectedValue(new Error('broker unavailable')));
    await processor.drain();
    expect(prisma.hiringOutboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: expect.objectContaining({ status: 'PENDING', attempts: 1, lockedAt: null, lastError: 'broker unavailable' }),
    });
  });

  it('recovers and completes a processing event whose lease expired', async () => {
    const stale = { ...event, status: 'PROCESSING', lockedAt: new Date(0) };
    const { processor, prisma, rabbit } = setup(jest.fn().mockResolvedValue(undefined), stale);
    await processor.drain();
    expect(prisma.hiringOutboxEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: stale.id }) }));
    expect(rabbit.publish).toHaveBeenCalledWith('hrms.hiring', 'screen', stale.payload.data);
    expect(prisma.hiringOutboxEvent.update).toHaveBeenCalledWith({ where: { id: stale.id }, data: expect.objectContaining({ status: 'COMPLETED', lockedAt: null }) });
  });
});

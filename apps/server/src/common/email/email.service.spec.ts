import { EmailService } from './email.service';

describe('EmailService idempotency', () => {
  it('does not publish another email job after the deterministic notification was sent', async () => {
    const prisma = { notification: { upsert: jest.fn().mockResolvedValue({ id: 'notification-1', status: 'SENT' }) } };
    const rabbit = { publish: jest.fn() };
    const service = new EmailService(prisma as any, rabbit as any);
    await service.send({
      tenantId: 'tenant-1', to: 'candidate@example.test', idempotencyKey: 'application-status:event-1',
      email: { subject: 'Update', html: '<p>Update</p>', text: 'Update' },
    });
    expect(prisma.notification.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_idempotencyKey: { tenantId: 'tenant-1', idempotencyKey: 'application-status:event-1' } } }));
    expect(rabbit.publish).not.toHaveBeenCalled();
  });
});

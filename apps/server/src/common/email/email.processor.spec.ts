import { ConfigService } from '@nestjs/config';
import { EmailProcessor } from './email.processor';

describe('EmailProcessor delivery lease', () => {
  it('marks a notification failed when the final RabbitMQ attempt fails', async () => {
    const prisma = {
      notification: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const processor = new EmailProcessor(
      prisma as any,
      {} as any,
      new ConfigService({ EMAIL_DRIVER: 'ses', AWS_REGION: 'ap-south-1' }),
    );
    jest
      .spyOn((processor as any).ses, 'send')
      .mockRejectedValue(new Error('SES unavailable'));
    jest.spyOn((processor as any).logger, 'warn').mockImplementation();

    await expect(
      processor.process(
        {
          notificationId: 'notification-1',
          to: 'candidate@example.test',
          subject: 'Update',
          html: '<p>Update</p>',
          text: 'Update',
        },
        4,
      ),
    ).rejects.toThrow('SES unavailable');
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'notification-1' },
      data: {
        status: 'FAILED',
        processingAt: null,
        error: 'SES unavailable',
      },
    });
  });
});

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Logger } from '@nestjs/common';

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.name} (id: ${job.id})`);

    if (job.name === 'send-email') {
      const { to, subject, body, tenantId } = job.data;
      
      // Mock sending email
      this.logger.log(`[MAILER MOCK] Sending email to: ${to}, subject: ${subject}`);
      
      try {
        await this.prisma.notification.create({
          data: {
            tenantId,
            channel: 'EMAIL',
            title: subject,
            body,
            recipientEmail: to,
            subject,
            status: 'SENT',
          },
        });
      } catch (err: any) {
        this.logger.error(`Failed to save notification log for email: ${err.message}`);
        throw err;
      }
    }
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private sesClient: SESClient | null = null;

  constructor(private readonly prisma: PrismaService) {
    super();
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
      this.logger.log('AWS SES Client initialized');
    } else {
      this.logger.warn('AWS SES credentials not found. Falling back to Mock Mailer.');
    }
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.name} (id: ${job.id})`);

    if (job.name === 'send-email') {
      const { to, subject, body, tenantId } = job.data;
      
      if (this.sesClient) {
        this.logger.log(`[AWS SES] Sending email to: ${to}`);
        const command = new SendEmailCommand({
          Source: process.env.AWS_SES_SENDER_EMAIL || 'noreply@yourdomain.com',
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: subject },
            Body: { Html: { Data: body } },
          },
        });
        try {
          await this.sesClient.send(command);
        } catch (error: any) {
          this.logger.error(`[AWS SES ERROR] Failed to send email: ${error.message}`);
        }
      } else {
        // Mock sending email
        this.logger.log(`[MAILER MOCK] Sending email to: ${to}, subject: ${subject}`);
      }
      
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

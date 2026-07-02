import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Processor('hiring')
export class HiringProcessor extends WorkerHost {
  private readonly logger = new Logger(HiringProcessor.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'screen-resume':
        return this.handleScreenResume(job.data);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  async handleScreenResume(data: { applicationId: string; jobId: string; resumeKey: string }) {
    this.logger.log(`Screening resume for application ${data.applicationId}...`);

    try {
      const job = await this.prisma.job.findUnique({ where: { id: data.jobId } });
      if (!job) return;

      const { score, reason } = await this.aiService.screenResume(
        job.title,
        job.description,
        data.resumeKey,
      );

      await this.prisma.application.update({
        where: { id: data.applicationId },
        data: { aiScore: score, aiReason: reason },
      });

      this.logger.log(`Application ${data.applicationId} scored: ${score} — ${reason}`);
    } catch (error: any) {
      this.logger.error(`Failed to screen resume: ${error.message}`);
    }
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GoogleGenAI } from '@google/genai';
import { S3Client } from '@aws-sdk/client-s3';

@Processor('hiring')
export class HiringProcessor extends WorkerHost {
  private readonly logger = new Logger(HiringProcessor.name);
  private ai: GoogleGenAI | null = null;

  constructor(private prisma: PrismaService) {
    super();
    if (process.env.GEMINI_API_KEY) {
      this.ai = new GoogleGenAI();
    }
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'screen-resume':
        return this.handleScreenResume(job.data);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  async handleScreenResume(data: { applicationId: string, jobId: string, resumeKey: string }) {
    this.logger.log(`Screening resume for application ${data.applicationId}...`);

    try {
      const job = await this.prisma.job.findUnique({ where: { id: data.jobId } });
      if (!job) return;

      const prompt = `
        You are an expert HR recruiter.
        Job Title: ${job.title}
        Job Description: ${job.description}
        
        Evaluate the candidate's resume against this job description.
        Return a single integer between 0 and 100 representing the match percentage. Do not include any other text.
      `;
      
      let aiScore = 50; 
      if (this.ai) {
        const response = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });
        const text = response.text || "50";
        aiScore = parseInt(text.trim(), 10) || 50;
      } else {
        this.logger.warn('GEMINI_API_KEY not set, using default AI score.');
      }

      await this.prisma.application.update({
        where: { id: data.applicationId },
        data: { aiScore },
      });

      this.logger.log(`Application ${data.applicationId} scored: ${aiScore}`);
    } catch (error: any) {
      this.logger.error(`Failed to screen resume: ${error.message}`);
    }
  }
}

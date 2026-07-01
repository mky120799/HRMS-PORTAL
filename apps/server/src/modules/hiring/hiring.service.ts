import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateJobDto } from './dto/job.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as crypto from 'crypto';

@Injectable()
export class HiringService {
  private readonly logger = new Logger(HiringService.name);
  private s3Client: S3Client | null = null;

  constructor(
    private prisma: PrismaService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
      this.logger.log('AWS S3 Client initialized');
    } else {
      this.logger.warn('AWS S3 credentials not found. Falling back to local upload logic.');
    }
  }

  async getPublicJobs() {
    return this.prisma.job.findMany({
      where: { status: 'OPEN' },
      include: { _count: { select: { applications: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getJobs(tenantId: string) {
    return this.prisma.job.findMany({
      where: { tenantId },
      include: { _count: { select: { applications: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createJob(tenantId: string, dto: CreateJobDto) {
    return this.prisma.job.create({
      data: {
        tenantId,
        title: dto.title,
        description: dto.description,
        department: dto.department,
        status: 'OPEN',
      },
    });
  }

  async updateJobStatus(tenantId: string, id: string, status: string) {
    return this.prisma.job.updateMany({
      where: { id, tenantId },
      data: { status },
    });
  }

  async getApplications(tenantId: string, jobId?: string) {
    return this.prisma.application.findMany({
      where: { job: { tenantId }, ...(jobId ? { jobId } : {}) },
      include: { job: { select: { id: true, title: true, department: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createApplication(jobId: string, candidateName: string, candidateEmail: string, filename: string, fileStream: any) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'OPEN') {
      throw new BadRequestException('Invalid job or job is closed');
    }

    let resumeUrl = filename ? `/uploads/${filename}` : null;
    let resumeFilename = filename || null;

    if (this.s3Client && filename && fileStream) {
      const bucket = process.env.AWS_S3_BUCKET_NAME || 'hrms-production-resumes-bucket';
      const uniqueFilename = `${crypto.randomUUID()}-${filename}`;
      try {
        const upload = new Upload({
          client: this.s3Client,
          params: {
            Bucket: bucket,
            Key: uniqueFilename,
            Body: fileStream,
          },
        });
        await upload.done();
        resumeUrl = `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${uniqueFilename}`;
        resumeFilename = uniqueFilename;
        this.logger.log(`Uploaded ${uniqueFilename} to S3`);
      } catch (error: any) {
        this.logger.error(`Failed to upload to S3: ${error.message}`);
        fileStream.resume(); // consume stream to avoid hanging if upload fails
      }
    } else if (fileStream) {
       // Mock fallback - consume stream to avoid hanging request
       fileStream.resume(); 
    }

    return this.prisma.application.create({
      data: {
        jobId,
        candidateName,
        candidateEmail,
        status: 'PENDING',
        resumeFilename,
        resumeUrl,
      },
    });
  }

  async updateApplicationStatus(id: string, status: string) {
    const app = await this.prisma.application.update({
      where: { id },
      data: { status },
      include: { job: true },
    });

    const message = `
      <h3>Application Update</h3>
      <p>Hi ${app.candidateName},</p>
      <p>Your application status for <strong>${app.job.title}</strong> has been updated to: <strong style="color: #4f46e5;">${status}</strong>.</p>
      <p>We will be in touch with next steps soon!</p>
      <br/>
      <p>Best,<br/>The HR Team</p>
    `;

    await this.notificationsQueue.add('send-email', {
      to: app.candidateEmail,
      subject: `Update on your application for ${app.job.title}`,
      body: message,
      tenantId: app.job.tenantId,
    });

    return app;
  }
}

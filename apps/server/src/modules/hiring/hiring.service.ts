import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateJobDto } from './dto/job.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class HiringService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

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

  async createApplication(jobId: string, candidateName: string, candidateEmail: string, filename: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'OPEN') {
      throw new BadRequestException('Invalid job or job is closed');
    }

    return this.prisma.application.create({
      data: {
        jobId,
        candidateName,
        candidateEmail,
        status: 'PENDING',
        resumeFilename: filename || null,
        resumeUrl: filename ? `/uploads/${filename}` : null,
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

import { Controller, Get, Post, Body, Param, UseGuards, Request, UsePipes, Patch, Query, ForbiddenException, Req, Res, BadRequestException } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { HiringService } from './hiring.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { createJobSchema } from './dto/job.dto';
import type { CreateJobDto } from './dto/job.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller()
export class HiringController {
  constructor(private readonly hiringService: HiringService) {}

  @Get('public/jobs')
  async getPublicJobs() {
    return this.hiringService.getPublicJobs();
  }

  @Get('jobs')
  @UseGuards(JwtAuthGuard)
  async getJobs(@Request() req: any) {
    return this.hiringService.getJobs(req.user.tenantId);
  }

  @Post('jobs')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ZodValidationPipe(createJobSchema))
  async createJob(@Request() req: any, @Body() dto: CreateJobDto) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can create jobs');
    }
    return this.hiringService.createJob(req.user.tenantId, dto);
  }

  @Patch('jobs/:id')
  @UseGuards(JwtAuthGuard)
  async updateJobStatus(@Request() req: any, @Param('id') id: string, @Body('status') status: string) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
    return this.hiringService.updateJobStatus(req.user.tenantId, id, status);
  }

  @Get('applications')
  @UseGuards(JwtAuthGuard)
  async getApplications(@Request() req: any, @Query('jobId') jobId?: string) {
    return this.hiringService.getApplications(req.user.tenantId, jobId);
  }

  @Post('applications')
  async createApplication(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    const data = await req.file();
    if (!data) {
       throw new BadRequestException('Multipart data missing');
    }
    const jobId = data.fields.jobId && 'value' in data.fields.jobId ? data.fields.jobId.value as string : '';
    const candidateName = data.fields.candidateName && 'value' in data.fields.candidateName ? data.fields.candidateName.value as string : '';
    const candidateEmail = data.fields.candidateEmail && 'value' in data.fields.candidateEmail ? data.fields.candidateEmail.value as string : '';

    if (!jobId || !candidateName || !candidateEmail) {
       throw new BadRequestException('Missing required fields');
    }

    const application = await this.hiringService.createApplication(jobId, candidateName, candidateEmail, data.filename);
    res.send(application);
  }

  @Patch('applications/:id')
  @UseGuards(JwtAuthGuard)
  async updateApplicationStatus(@Request() req: any, @Param('id') id: string, @Body('status') status: string) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
    return this.hiringService.updateApplicationStatus(id, status);
  }
}

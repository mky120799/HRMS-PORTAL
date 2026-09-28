import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { HiringService } from './hiring.service';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { RequiresPlan } from '../../common/decorators/plan.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { ApplicationStatus } from '../../common/constants/domain';
import {
  createJobSchema,
  listApplicationsSchema,
  scheduleInterviewSchema,
  updateApplicationSchema,
  updateJobSchema,
  type CreateJobDto,
  type ListApplicationsQuery,
  type ScheduleInterviewDto,
  type UpdateJobDto,
} from './dto/job.dto';

/** Public careers site: /careers/:slug */
@ApiTags('Careers (public)')
@Public()
@Controller('careers')
export class CareersController {
  constructor(private readonly hiring: HiringService) {}

  @Get(':slug')
  careers(@Param('slug') slug: string) {
    return this.hiring.careers(slug);
  }

  /** multipart/form-data: resume (PDF/DOCX ≤ 5 MB), candidateName, candidateEmail, consent=true */
  @Post(':slug/jobs/:jobId/apply')
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  async apply(@Param('slug') slug: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Req() req: FastifyRequest) {
    return this.hiring.apply(slug, jobId, await req.file());
  }
}

@ApiTags('Hiring')
@ApiBearerAuth()
@Controller('hiring')
@RequiresPlan('BASIC')
@Roles('ADMIN', 'MANAGER')
export class HiringController {
  constructor(private readonly hiring: HiringService) {}

  @Get('jobs')
  jobs(@CurrentUser() user: AuthUser) {
    return this.hiring.jobs(user.tenantId);
  }

  @Post('jobs')
  @Roles('ADMIN')
  createJob(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createJobSchema)) dto: CreateJobDto) {
    return this.hiring.createJob(user.tenantId, dto);
  }

  @Patch('jobs/:id')
  @Roles('ADMIN')
  updateJob(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateJobSchema)) dto: UpdateJobDto) {
    return this.hiring.updateJob(user.tenantId, id, dto);
  }

  @Get('applications')
  applications(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listApplicationsSchema)) q: ListApplicationsQuery) {
    return this.hiring.applications(user.tenantId, q);
  }

  @Get('applications/:id/resume')
  async resume(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { stream, mimeType, filename } = await this.hiring.resume(user.tenantId, id);
    return new StreamableFile(stream, { type: mimeType, disposition: `attachment; filename="${filename}"` });
  }

  @Patch('applications/:id')
  @Roles('ADMIN')
  updateStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateApplicationSchema)) dto: { status: ApplicationStatus }) {
    return this.hiring.updateStatus(user, id, dto.status);
  }

  @Post('applications/:id/schedule-interview')
  scheduleInterview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(scheduleInterviewSchema)) dto: ScheduleInterviewDto) {
    return this.hiring.scheduleInterview(user, id, dto);
  }

  @Post('applications/:id/rescreen')
  @Roles('ADMIN')
  @RequiresPlan('ENTERPRISE')
  rescreen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.hiring.rescreen(user, id);
  }
}

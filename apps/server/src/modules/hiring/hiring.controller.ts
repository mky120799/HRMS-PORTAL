import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { HiringService } from './hiring.service';
import { AssessmentIntegrationService } from './assessment-integration.service';
import { HiringWorkflowService } from './hiring-workflow.service';
import { HiringFeedbackService } from './hiring-feedback.service';
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
  upsertFeedbackSchema,
  type CreateJobDto,
  type ListApplicationsQuery,
  type ScheduleInterviewDto,
  type UpdateJobDto,
  createHiringStageSchema,
  moveApplicationSchema,
  updateHiringStageSchema,
  createAssessmentIntegrationSchema,
  createAssessmentRequestSchema,
  type CreateAssessmentIntegrationDto,
  type CreateAssessmentRequestDto,
  type CreateHiringStageDto,
  type MoveApplicationDto,
  type UpdateHiringStageDto,
  type UpsertFeedbackDto,
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
  constructor(
    private readonly hiring: HiringService,
    private readonly assessments: AssessmentIntegrationService,
    private readonly workflow: HiringWorkflowService,
    private readonly feedback: HiringFeedbackService,
  ) {}

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

  @Get('stages')
  stages(@CurrentUser() user: AuthUser) {
    return this.workflow.listStages(user.tenantId);
  }

  @Post('stages')
  @Roles('ADMIN')
  createStage(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createHiringStageSchema)) dto: CreateHiringStageDto) {
    return this.workflow.createStage(user, dto);
  }

  @Patch('stages/:id')
  @Roles('ADMIN')
  updateStage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateHiringStageSchema)) dto: UpdateHiringStageDto) {
    return this.workflow.updateStage(user, id, dto);
  }

  @Get('applications')
  applications(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listApplicationsSchema)) q: ListApplicationsQuery) {
    return this.hiring.applications(user.tenantId, q);
  }

  @Get('applications/:id/timeline')
  applicationTimeline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.timeline(user.tenantId, id);
  }

  @Post('applications/:id/move')
  moveApplication(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(moveApplicationSchema)) dto: MoveApplicationDto) {
    return this.workflow.move(user, id, dto);
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

  @Get('assessment-integrations')
  @Roles('ADMIN')
  assessmentIntegrations(@CurrentUser() user: AuthUser) {
    return this.assessments.listIntegrations(user.tenantId);
  }

  @Post('assessment-integrations')
  @Roles('ADMIN')
  createAssessmentIntegration(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createAssessmentIntegrationSchema)) dto: CreateAssessmentIntegrationDto) {
    return this.assessments.createIntegration(user, dto);
  }

  @Post('assessment-integrations/:id/rotate-webhook-secret')
  @Roles('ADMIN')
  rotateAssessmentWebhookSecret(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.rotateWebhookSecret(user, id);
  }

  @Get('applications/:id/assessments')
  assessmentRequests(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.listRequests(user.tenantId, id);
  }

  @Post('applications/:id/assessments')
  createAssessmentRequest(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createAssessmentRequestSchema)) dto: CreateAssessmentRequestDto) {
    return this.assessments.createRequest(user, id, dto);
  }

  // ─── Interview Feedback ──────────────────────────────────────────────────────

  @Get('applications/:id/feedback')
  listFeedback(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.feedback.list(user.tenantId, id);
  }

  @Post('applications/:id/feedback')
  upsertFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(upsertFeedbackSchema)) dto: UpsertFeedbackDto,
  ) {
    return this.feedback.upsert(user, id, dto);
  }

  @Delete('applications/:id/feedback')
  deleteFeedback(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.feedback.remove(user, id);
  }
}

/** Public vendor callback; signature is verified against the integration secret. */
@Controller('hiring/assessment-integrations')
export class AssessmentWebhookController {
  constructor(private readonly assessments: AssessmentIntegrationService) {}

  @Public()
  @SkipThrottle()
  @Post(':id/webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  webhook(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-assessment-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<FastifyRequest>,
  ) {
    return this.assessments.handleWebhook(id, signature, req.rawBody);
  }
}

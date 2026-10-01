import { z } from 'zod';
import { APPLICATION_SOURCES, APPLICATION_STATUSES, ASSESSMENT_STATUSES, FEEDBACK_RECOMMENDATIONS, JOB_STATUSES } from '../../../common/constants/domain';
import { email, paginationSchema } from '../../../common/validation/common.schemas';

export const createJobSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(20).max(10_000),
  department: z.string().trim().min(1).max(100),
  location: z.string().trim().max(100).optional(),
});
export type CreateJobDto = z.infer<typeof createJobSchema>;

export const updateJobSchema = createJobSchema.partial().extend({ status: z.enum(JOB_STATUSES).optional() });
export type UpdateJobDto = z.infer<typeof updateJobSchema>;

export const listApplicationsSchema = paginationSchema.extend({
  jobId: z.string().uuid().optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  source: z.enum(APPLICATION_SOURCES).optional(),
});
export type ListApplicationsQuery = z.infer<typeof listApplicationsSchema>;

export const updateApplicationSchema = z.object({ status: z.enum(APPLICATION_STATUSES) });

const stageKey = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,49}$/, 'Use an uppercase stage key, such as TECHNICAL_INTERVIEW');
export const createHiringStageSchema = z.object({
  key: stageKey,
  name: z.string().trim().min(2).max(80),
  category: z.enum(APPLICATION_STATUSES),
  position: z.number().int().min(1).max(10_000),
});
export type CreateHiringStageDto = z.infer<typeof createHiringStageSchema>;

export const updateHiringStageSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  position: z.number().int().min(1).max(10_000).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one stage change');
export type UpdateHiringStageDto = z.infer<typeof updateHiringStageSchema>;

export const moveApplicationSchema = z.object({
  stageId: z.string().uuid(),
  note: z.string().trim().min(1).max(2_000).optional(),
});
export type MoveApplicationDto = z.infer<typeof moveApplicationSchema>;

export const scheduleInterviewSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(480).default(45),
  interviewerEmail: email.optional(),
  location: z.string().trim().max(300).optional(), // room or video link
  isReschedule: z.boolean().default(false),
});
export type ScheduleInterviewDto = z.infer<typeof scheduleInterviewSchema>;

export const createAssessmentIntegrationSchema = z.object({
  provider: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,50}$/, 'Use an uppercase provider key, such as HACKERRANK'),
  displayName: z.string().trim().min(2).max(100),
  config: z.record(z.unknown()).optional(),
});
export type CreateAssessmentIntegrationDto = z.infer<typeof createAssessmentIntegrationSchema>;

export const createAssessmentRequestSchema = z.object({
  integrationId: z.string().uuid(),
  externalId: z.string().trim().min(1).max(200).optional(),
  assessmentUrl: z.string().url().max(2_000).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateAssessmentRequestDto = z.infer<typeof createAssessmentRequestSchema>;

/** Generic signed callback shape for vendors without a first-class adapter. */
export const assessmentWebhookSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  externalId: z.string().trim().min(1).max(200),
  status: z.enum(ASSESSMENT_STATUSES),
  score: z.number().min(0).max(100).optional(),
  recommendation: z.string().trim().max(100).optional(),
  reportUrl: z.string().url().max(2_000).optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
});
export type AssessmentWebhookDto = z.infer<typeof assessmentWebhookSchema>;

export const applySchema = z.object({
  candidateName: z.string().trim().min(2).max(120),
  candidateEmail: email,
  consent: z.literal('true', { errorMap: () => ({ message: 'You must consent to data processing to apply' }) }),
  source: z.enum(APPLICATION_SOURCES).optional(),
});

// ─── Interview Feedback ───────────────────────────────────────────────────────

export const upsertFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  recommendation: z.enum(FEEDBACK_RECOMMENDATIONS),
  notes: z.string().trim().max(5_000).optional(),
});
export type UpsertFeedbackDto = z.infer<typeof upsertFeedbackSchema>;

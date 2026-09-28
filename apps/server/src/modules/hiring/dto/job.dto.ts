import { z } from 'zod';
import { APPLICATION_STATUSES, JOB_STATUSES } from '../../../common/constants/domain';
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
});
export type ListApplicationsQuery = z.infer<typeof listApplicationsSchema>;

export const updateApplicationSchema = z.object({ status: z.enum(APPLICATION_STATUSES) });

export const scheduleInterviewSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(480).default(45),
  interviewerEmail: email.optional(),
  location: z.string().trim().max(300).optional(), // room or video link
});
export type ScheduleInterviewDto = z.infer<typeof scheduleInterviewSchema>;

export const applySchema = z.object({
  candidateName: z.string().trim().min(2).max(120),
  candidateEmail: email,
  consent: z.literal('true', { errorMap: () => ({ message: 'You must consent to data processing to apply' }) }),
});

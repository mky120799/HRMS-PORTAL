import { z } from 'zod';

export const createJobSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  department: z.string().min(1).max(100),
});

export type CreateJobDto = z.infer<typeof createJobSchema>;

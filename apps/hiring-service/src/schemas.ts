import { z } from 'zod';

export const createJobSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  department: z.string().min(1).max(100),
});

export const createApplicationSchema = z.object({
  jobId: z.string().uuid(),
  candidateName: z.string().min(1).max(200),
  candidateEmail: z.string().email(),
});

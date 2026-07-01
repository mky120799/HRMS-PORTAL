import { z } from 'zod';

export const createLeaveRequestSchema = z.object({
  employeeId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  type: z.string().optional(),
  reason: z.string().optional(),
});

export type CreateLeaveRequestDto = z.infer<typeof createLeaveRequestSchema>;

import { z } from 'zod';

export const createEmployeeSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  department: z.string().optional(),
  userId: z.string().uuid().optional(),
});

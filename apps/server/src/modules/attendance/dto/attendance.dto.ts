import { z } from 'zod';

export const clockInSchema = z.object({
  employeeId: z.string().uuid(),
});
export type ClockInDto = z.infer<typeof clockInSchema>;

export const clockOutSchema = z.object({
  employeeId: z.string().uuid(),
});
export type ClockOutDto = z.infer<typeof clockOutSchema>;

import { z } from 'zod';

export const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
});
export type InviteDto = z.infer<typeof inviteSchema>;

export const resetRequestSchema = z.object({
  email: z.string().email(),
  tenantId: z.string().uuid(),
});
export type ResetRequestDto = z.infer<typeof resetRequestSchema>;

export const setPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8),
});
export type SetPasswordDto = z.infer<typeof setPasswordSchema>;

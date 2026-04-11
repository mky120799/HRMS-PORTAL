import { z } from 'zod';

export const signupBodySchema = z.object({
  tenantName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
});

export const loginBodySchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

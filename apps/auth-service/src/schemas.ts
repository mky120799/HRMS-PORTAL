import { z } from 'zod';

export const loginSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerInternalSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
});

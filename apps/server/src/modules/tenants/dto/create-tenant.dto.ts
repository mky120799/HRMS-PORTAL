import { z } from 'zod';

export const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().max(100).optional(),
});

export type CreateTenantDto = z.infer<typeof createTenantSchema>;

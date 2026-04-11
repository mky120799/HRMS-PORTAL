import { z } from 'zod';

export const channelSchema = z.enum(['EMAIL', 'IN_APP', 'SMS']);

export const internalCreateSchema = z.object({
  tenantId: z.string().uuid(),
  channel: channelSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  recipientUserId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
});

export const userCreateSchema = z.object({
  channel: channelSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  recipientUserId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

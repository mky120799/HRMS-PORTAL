import { z } from 'zod';

export const channelSchema = z.enum(['EMAIL', 'IN_APP', 'SMS']);

export const internalCreateSchema = z.object({
  tenantId: z.string().uuid(),
  channel: channelSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  recipientUserId: z.string().uuid().optional(),
  recipientEmail: z.string().email().optional(),
  subject: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
});

export const userCreateSchema = z.object({
  channel: channelSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  recipientUserId: z.string().uuid().optional(),
  recipientEmail: z.string().email().optional(),
  subject: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const composeEmailSchema = z.object({
  to: z.string().email('Recipient email is required'),
  subject: z.string().min(1, 'Subject is required').max(200),
  body: z.string().min(1, 'Body is required').max(50000),
});

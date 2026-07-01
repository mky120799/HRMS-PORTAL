import { z } from 'zod';

export const createNotificationSchema = z.object({
  channel: z.enum(['EMAIL', 'PUSH', 'IN_APP']).default('IN_APP'),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  recipientUserId: z.string().optional(),
  recipientEmail: z.string().email().optional(),
  subject: z.string().optional(),
  metadata: z.any().optional(),
});

export const composeEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

export type CreateNotificationDto = z.infer<typeof createNotificationSchema>;
export type ComposeEmailDto = z.infer<typeof composeEmailSchema>;

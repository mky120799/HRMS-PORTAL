import { z } from 'zod';
import { email, paginationSchema } from '../../../common/validation/common.schemas';

export const composeEmailSchema = z.object({
  to: email,
  subject: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(50_000),
});
export type ComposeEmailDto = z.infer<typeof composeEmailSchema>;

export const announceSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(50_000),
  department: z.string().trim().max(100).optional(), // omit to send to everyone
});
export type AnnounceDto = z.infer<typeof announceSchema>;

export const listNotificationsSchema = paginationSchema.extend({ scope: z.enum(['mine', 'all']).default('mine') });
export type ListNotificationsQuery = z.infer<typeof listNotificationsSchema>;

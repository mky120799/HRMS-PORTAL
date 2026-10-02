import { z } from 'zod';
import {
  email,
  paginationSchema,
} from '../../../common/validation/common.schemas';

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

export const createNotificationCampaignSchema = announceSchema.extend({
  scheduledAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateNotificationCampaignDto = z.infer<
  typeof createNotificationCampaignSchema
>;

export const listNotificationsSchema = paginationSchema.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  category: z.string().trim().min(1).max(50).optional(),
  unread: z.enum(['true', 'false']).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsSchema>;

export const updateNotificationPreferenceSchema = z.object({
  eventType: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^(\*|[A-Z][A-Z0-9_]*)$/, 'Use * or an uppercase event type'),
  channel: z.enum(['IN_APP', 'EMAIL']),
  enabled: z.boolean(),
});
export type UpdateNotificationPreferenceDto = z.infer<
  typeof updateNotificationPreferenceSchema
>;

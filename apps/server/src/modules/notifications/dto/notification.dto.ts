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

export const updateNotificationSettingsSchema = z.object({
  timezone: z.string().trim().min(1).max(100).optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietStartMinutes: z.number().int().min(0).max(1439).nullable().optional(),
  quietEndMinutes: z.number().int().min(0).max(1439).nullable().optional(),
  digestFrequency: z.enum(['IMMEDIATE', 'DAILY', 'WEEKLY']).optional(),
  digestHour: z.number().int().min(0).max(23).optional(),
  digestDayOfWeek: z.number().int().min(0).max(6).optional(),
});
export type UpdateNotificationSettingsDto = z.infer<
  typeof updateNotificationSettingsSchema
>;

const sesTagSchema = z.union([z.string(), z.array(z.string())]).optional();
export const emailWebhookSchema = z
  .object({
    eventId: z.string().trim().min(1).max(200).optional(),
    notificationId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
    email: email.optional(),
    eventType: z.string().trim().min(1).max(100).optional(),
    status: z.string().trim().min(1).max(100).optional(),
    mail: z
      .object({
        messageId: z.string().optional(),
        destination: z.array(email).optional(),
        tags: z
          .object({
            notificationId: sesTagSchema,
            tenantId: sesTagSchema,
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    delivery: z.object({ timestamp: z.string().optional() }).passthrough().optional(),
    bounce: z.object({ timestamp: z.string().optional() }).passthrough().optional(),
    complaint: z.object({ timestamp: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();
export type EmailWebhookDto = z.infer<typeof emailWebhookSchema>;

export const createNotificationTemplateSchema = z.object({
  eventType: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Use an uppercase event type'),
  channel: z.enum(['EMAIL']).default('EMAIL'),
  subjectTemplate: z.string().trim().min(1).max(300),
  htmlTemplate: z.string().min(1).max(50_000),
  textTemplate: z.string().min(1).max(20_000),
  isActive: z.boolean().default(true),
});
export type CreateNotificationTemplateDto = z.infer<
  typeof createNotificationTemplateSchema
>;

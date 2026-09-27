import { z } from 'zod';
import { isValidIpRule } from '../../../common/utils/ip-match';
import { isValidTimeZone } from '../../../common/utils/dates';

/** Only genuine Slack incoming-webhook URLs are accepted — anything else would let an
 *  admin make our servers call arbitrary internal URLs (SSRF). */
const slackWebhook = z
  .string()
  .trim()
  .regex(/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/, 'Must be a Slack incoming webhook URL (https://hooks.slack.com/services/...)');

export const updateSettingsSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone').optional(),
  whitelistedIps: z.array(z.string().trim().refine(isValidIpRule, 'Invalid IP address or CIDR range')).max(50).optional(),
  // null clears the webhook; undefined leaves it unchanged
  slackWebhookUrl: slackWebhook.nullable().optional(),
  slackHiringWebhookUrl: slackWebhook.nullable().optional(),
});
export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>;

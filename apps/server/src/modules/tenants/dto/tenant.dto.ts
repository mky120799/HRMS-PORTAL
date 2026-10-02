import { z } from 'zod';
import { isValidIpRule } from '../../../common/utils/ip-match';
import { isValidTimeZone } from '../../../common/utils/dates';
import { CUSTOM_ROLE_REF, IDP_ASSIGNABLE_ROLES } from '../../auth/sso-mapping';

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

export const updateAuthPolicySchema = z.object({
  allowPasswordLogin: z.boolean().optional(),
  allowGoogleLogin: z.boolean().optional(),
  requireMfaForAdmins: z.boolean().optional(),
  requireMfaForAll: z.boolean().optional(),
  passwordMinLength: z.number().int().min(10).max(128).optional(),
  passwordHistoryCount: z.number().int().min(0).max(24).optional(),
  passwordExpiresDays: z.number().int().min(1).max(730).nullable().optional(),
  sessionIdleMinutes: z.number().int().min(5).max(60 * 24 * 30).nullable().optional(),
  sessionAbsoluteHours: z.number().int().min(1).max(168).optional(),
});
export type UpdateAuthPolicyDto = z.infer<typeof updateAuthPolicySchema>;

const url = z.string().trim().url();
const samlAttribute = z.string().trim().max(300).optional();

const identityProviderBaseSchema = z.object({
  providerType: z.enum(['OIDC', 'SAML']),
  name: z.string().trim().min(2).max(100),
  issuerUrl: url.optional(),
  clientId: z.string().trim().max(300).optional(),
  clientSecret: z.string().max(2000).optional(),
  samlEntityId: z.string().trim().max(500).optional(),
  samlSsoUrl: url.optional(),
  samlCertificate: z.string().max(8000).optional(),
  allowedDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20).default([]),
  // IdP group/role value → HRMS role or "custom:<KEY>". ADMIN is deliberately not assignable from an IdP.
  roleMapping: z
    .record(
      z.string().trim().min(1).max(200),
      z.union([z.enum(IDP_ASSIGNABLE_ROLES as unknown as [string, ...string[]]), z.string().regex(CUSTOM_ROLE_REF, 'Use a role name or custom:<KEY>')]),
    )
    .refine((value) => Object.keys(value).length <= 50, 'At most 50 group mappings')
    .nullable()
    .optional(),
  // SAML attribute names; empty means "use the common defaults".
  attributeMapping: z
    .object({
      email: samlAttribute,
      firstName: samlAttribute,
      lastName: samlAttribute,
      displayName: samlAttribute,
      groups: samlAttribute,
    })
    .nullable()
    .optional(),
  jitProvisioning: z.boolean().default(false),
  scimEnabled: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const identityProviderSchema = identityProviderBaseSchema.superRefine((value, ctx) => {
  if (value.jitProvisioning && value.allowedDomains.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Just-in-time provisioning requires at least one allowed email domain', path: ['allowedDomains'] });
  }
  if (value.providerType === 'OIDC' && (!value.issuerUrl || !value.clientId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'OIDC requires issuerUrl and clientId', path: ['issuerUrl'] });
  }
  if (value.providerType === 'SAML' && (!value.samlEntityId || !value.samlSsoUrl || !value.samlCertificate)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SAML requires entity ID, SSO URL and certificate', path: ['samlEntityId'] });
  }
});
export type IdentityProviderDto = z.infer<typeof identityProviderSchema>;

export const updateIdentityProviderSchema = identityProviderBaseSchema.partial();
export type UpdateIdentityProviderDto = z.infer<typeof updateIdentityProviderSchema>;

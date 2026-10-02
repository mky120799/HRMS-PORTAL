import { z } from 'zod';

/**
 * Single source of truth for configuration. The process refuses to boot when a
 * required variable is missing or malformed, instead of silently falling back
 * to an insecure default.
 */
const optionalUrl = z.string().url().optional().or(z.literal('').transform(() => undefined));
const optionalString = z.string().optional().or(z.literal('').transform(() => undefined));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().url().default('amqp://guest:guest@localhost:5672'),
    // Shared rate-limit counters; in-memory per instance when unset (development only).
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, 'must be a redis:// or rediss:// URL')
      .optional()
      .or(z.literal('').transform(() => undefined)),

    // Root secret; purpose-specific signing keys are derived from it (see TokenService).
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    // 32-byte key, base64 encoded — used for field-level encryption (2FA secrets, webhook URLs).
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64 encoded'),

    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    API_PUBLIC_URL: optionalUrl,
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    PUBLIC_SIGNUP_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    ENABLE_SWAGGER: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),

    // Object storage. STORAGE_DRIVER=local is for development only.
    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./storage'),
    AWS_REGION: z.string().default('us-east-1'),
    AWS_S3_BUCKET_NAME: optionalString,

    // Email. EMAIL_DRIVER=log only writes emails to the log (development).
    EMAIL_DRIVER: z.enum(['ses', 'log']).default('log'),
    EMAIL_FROM: z.string().default('HRMS <noreply@example.com>'),
    EMAIL_WEBHOOK_SECRET: optionalString,

    NOTIFICATION_HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
    NOTIFICATION_COMPLETED_OUTBOX_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    NOTIFICATION_RETENTION_CLEANUP_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),

    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GOOGLE_CALLBACK_URL: optionalUrl,
    OIDC_CALLBACK_URL: optionalUrl,
    // Development/test only: let OIDC issuers live on localhost/private networks (e.g. a local Keycloak).
    ALLOW_PRIVATE_IDP_URLS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    STRIPE_PRICE_BASIC: optionalString,
    STRIPE_PRICE_BUSINESS: optionalString,
    STRIPE_PRICE_ENTERPRISE: optionalString,

    SENTRY_DSN: optionalUrl,
  })
  .superRefine((env, ctx) => {
    // Credentialed CORS (the refresh cookie) must never be combined with a wildcard origin.
    if (env.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ORIGINS'], message: 'must list explicit origins, not "*"' });
    }
    if (env.NODE_ENV !== 'production') return;
    const require = (key: keyof typeof env, message: string) => {
      if (!env[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
    };
    if (env.STORAGE_DRIVER !== 's3') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STORAGE_DRIVER'], message: 'must be "s3" in production (container disks are ephemeral)' });
    }
    require('AWS_S3_BUCKET_NAME', 'required when STORAGE_DRIVER=s3');
    require('REDIS_URL', 'required in production so rate limits are shared by every API instance');
    if (env.EMAIL_DRIVER !== 'ses') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_DRIVER'], message: 'must be "ses" in production' });
    }
    require('EMAIL_WEBHOOK_SECRET', 'required for SES delivery/bounce/complaint callbacks');
    if (env.FRONTEND_URL.startsWith('http://')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['FRONTEND_URL'], message: 'must use https in production' });
    }
    if (env.API_PUBLIC_URL?.startsWith('http://')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['API_PUBLIC_URL'], message: 'must use https in production' });
    }
    if (env.ALLOW_PRIVATE_IDP_URLS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ALLOW_PRIVATE_IDP_URLS'], message: 'must be false in production (SSRF protection)' });
    }
    if (env.OIDC_CALLBACK_URL?.startsWith('http://')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['OIDC_CALLBACK_URL'], message: 'must use https in production' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

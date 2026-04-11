import 'dotenv/config';

function optional(name: string): string | undefined {
  return process.env[name] ?? undefined;
}

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 3005),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  internalServiceSecret: required('INTERNAL_SERVICE_SECRET'),
  // SMTP – if not set, Nodemailer auto-creates an Ethereal.email test account
  smtpHost: optional('SMTP_HOST'),
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: optional('SMTP_USER'),
  smtpPass: optional('SMTP_PASS'),
  smtpFrom: process.env.SMTP_FROM ?? 'HRMS Portal <noreply@hrms.dev>',
};

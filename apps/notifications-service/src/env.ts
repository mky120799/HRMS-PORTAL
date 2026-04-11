import 'dotenv/config';

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
};

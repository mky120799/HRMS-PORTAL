import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Same lookup as the API: apps/server/.env first, then the repository root .env.
config({ path: ['.env', '../../.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  engine: 'classic',
  datasource: {
    url: env('DATABASE_URL'),
  },
});

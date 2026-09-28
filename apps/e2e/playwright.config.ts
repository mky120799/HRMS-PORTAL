import { defineConfig, devices } from '@playwright/test';

/**
 * Full-stack browser smoke tests: real API + real database + production web build.
 * Requires DATABASE_URL (migrated), Redis, JWT_SECRET and ENCRYPTION_KEY in the environment
 * and `npm run build` beforehand (see .github/workflows/ci-cd.yml).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node dist/main',
      cwd: '../server',
      url: 'http://localhost:3000/api/v1/health/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { NODE_ENV: 'test', EMAIL_DRIVER: 'log', STORAGE_DRIVER: 'local', FRONTEND_URL: 'http://localhost:5173', CORS_ORIGINS: 'http://localhost:5173' },
    },
    {
      command: 'npm run preview',
      cwd: '../web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

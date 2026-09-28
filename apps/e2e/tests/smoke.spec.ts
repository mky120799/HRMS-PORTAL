import { test, expect, type Page } from '@playwright/test';

const PASSWORD = 'Str0ng-Passw0rd!';
const unique = () => Math.random().toString(16).slice(2, 8);

async function signup(page: Page) {
  const company = `Smoke ${unique()}`;
  const email = `owner-${unique()}@example.com`;
  await page.goto('/signup');
  await page.locator('input[name="tenantName"]').fill(company);
  await page.locator('input[name="name"]').fill('Olivia Owner');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /get started/i }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  return { company, email };
}

test('login validates input and rejects bad credentials', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Welcome Back')).toBeVisible();
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByText('Workspace is required')).toBeVisible();

  await page.locator('input[name="tenantId"]').fill('no-such-workspace');
  await page.locator('input[name="email"]').fill('nobody@example.com');
  await page.locator('input[name="password"]').fill('wrong-password-1');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByText('Invalid credentials')).toBeVisible();
});

test('a new company signs up, loads sample data and uses core features', async ({ page }) => {
  await signup(page);

  await page.getByRole('button', { name: /load sample data/i }).click();
  await expect(page).toHaveURL('/', { timeout: 30_000 });

  await page.goto('/employees');
  await expect(page.getByText(/21 people/)).toBeVisible();

  await page.goto('/leave');
  await expect(page.getByText('ANNUAL').first()).toBeVisible();

  await page.goto('/payroll');
  await expect(page.getByText('Salary structures')).toBeVisible();
  await expect(page.getByText('FINALIZED', { exact: true })).toBeVisible();

  await page.goto('/hiring');
  await expect(page.getByText('Senior Software Engineer').first()).toBeVisible();
  await expect(page.getByText('Candidates', { exact: true })).toBeVisible();
});

test('the public careers page lists only that company’s jobs', async ({ page, request }) => {
  await signup(page);
  await page.getByRole('button', { name: /load sample data/i }).click();
  await expect(page).toHaveURL('/', { timeout: 30_000 });

  const slug = await page.evaluate(() => JSON.parse(localStorage.getItem('hrms_auth') ?? '{}').tenant?.slug);
  expect(slug).toBeTruthy();

  await page.goto(`/careers/${slug}`);
  await expect(page.getByRole('heading', { name: /Careers at Smoke/ })).toBeVisible();
  await expect(page.getByText('Account Executive')).toBeVisible();

  const res = await request.get(`http://localhost:3000/api/v1/careers/${slug}`);
  expect(await res.text()).not.toContain('tenantId');
});

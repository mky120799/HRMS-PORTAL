import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should navigate to login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/HRMS/);
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  });

  test('should show validation errors on empty submission', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Email is required')).toBeVisible();
    await expect(page.getByText('Password is required')).toBeVisible();
  });

  test('should allow user to toggle password visibility', async ({ page }) => {
    await page.goto('/login');
    const passwordInput = page.getByPlaceholder('••••••••');
    await passwordInput.fill('secretpassword');
    
    // Default is password
    await expect(passwordInput).toHaveAttribute('type', 'password');
    
    // Click toggle
    await page.getByRole('button', { name: /toggle password/i }).click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
  });
});

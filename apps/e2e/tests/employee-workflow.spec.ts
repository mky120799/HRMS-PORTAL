import { test, expect } from '@playwright/test';

test.describe('Employee Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock login by setting localStorage item
    await page.addInitScript(() => {
      window.localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          user: { id: 'admin1', name: 'Admin User', role: 'ADMIN', tenantId: 'tenant1' },
          accessToken: 'fake-token',
        },
        version: 0
      }));
    });
  });

  test('should render employees list and invite button', async ({ page }) => {
    // Intercept API call to return mock employees
    await page.route('**/api/v1/employees?limit=50&page=1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            data: [
              { id: '1', name: 'John Doe', email: 'john@example.com', role: 'EMPLOYEE', status: 'ACTIVE' }
            ],
            meta: { total: 1, page: 1, lastPage: 1 }
          }
        }),
      });
    });

    await page.goto('/employees');
    await expect(page.getByRole('heading', { name: 'Directory' })).toBeVisible();
    await expect(page.getByText('John Doe')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invite Employee' })).toBeVisible();
  });
});

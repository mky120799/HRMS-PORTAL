import { test, expect } from '@playwright/test';

test.describe('Leave Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock login by setting localStorage item
    await page.addInitScript(() => {
      window.localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          user: { id: 'emp1', name: 'Test Employee', role: 'EMPLOYEE', tenantId: 'tenant1' },
          accessToken: 'fake-token',
        },
        version: 0
      }));
    });
  });

  test('should render leaves page and request button', async ({ page }) => {
    // Intercept API call
    await page.route('**/api/v1/leaves*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            data: [],
            meta: { total: 0, page: 1, lastPage: 1 }
          }
        }),
      });
    });

    await page.goto('/leaves');
    await expect(page.getByRole('heading', { name: 'Time Off' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request Time Off' })).toBeVisible();
  });
});

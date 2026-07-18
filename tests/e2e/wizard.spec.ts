import { test, expect } from '@playwright/test';

test.describe('setup wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/settings/test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    );
    await page.route('**/api/notifications/test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    );
  });

  test('happy path: welcome → login → skip everything skippable → done', async ({ page }) => {
    await page.goto('/wizard');
    // step 1 - welcome
    await page.getByRole('button', { name: "Let's go" }).click();
    // step 2 - create the single-user password
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByLabel('Confirm password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create password' }).click();
    // steps 3-9 - every one is skippable per spec §5.1
    await expect(page.getByRole('heading', { name: 'AI brain' })).toBeVisible();
    // Progress is saved per step: reload resumes where you left off.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'AI brain' })).toBeVisible();
    for (let i = 0; i < 7; i++) {
      await page.getByRole('button', { name: 'Skip for now' }).click();
    }
    // step 10 - done: finish-later links for the skipped sections, then dashboard
    await expect(page.getByRole('heading', { name: /Done/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Finish later' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Take me to my dashboard' }).click();
    await expect(page).toHaveURL('/');
  });
});

import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('task creation and cron tick produce an in-app reminder', async ({ page }) => {
  await login(page);
  await page.goto('/tasks');
  await page.getByLabel(/task title/i).fill('Pay housing deposit');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Pay housing deposit')).toBeVisible();

  const csrf = (await page.context().cookies())
    .find((cookie) => cookie.name === 'redi_csrf')?.value ?? '';
  const created = await page.context().request.post('/api/tasks', {
    data: {
      title: 'Advising appointment',
      due_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: { 'x-csrf-token': csrf },
  });
  expect(created.ok()).toBeTruthy();

  const tick = await page.context().request.post('/api/cron/tick', {
    headers: { 'X-Redi-Cron-Secret': 'e2e-cron-secret' },
  });
  expect(tick.ok()).toBeTruthy();

  await page.goto('/notifications');
  await expect(page.getByText(/Advising appointment/i).first())
    .toBeVisible({ timeout: 10_000 });
});

import { expect, test } from '@playwright/test';

const PASSWORD = 'correct horse battery';

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({
    baseURL: process.env.REDI_BASE_URL ?? 'http://127.0.0.1:3100',
  });
  await request.post('/api/auth/setup', { data: { password: PASSWORD } });
  await request.dispose();
});

test.beforeEach(async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
});

test('email center checks inbox and manages sender rules', async ({ page }) => {
  await page.goto('/email');
  await expect(page.getByRole('heading', { name: 'College email' })).toBeVisible();
  await expect(page.getByText('No emails processed yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText(/College inbox is not connected|Checked:/)).toBeVisible();

  await page.getByLabel('Sender pattern').fill('spammy.example');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('spammy.example')).toBeVisible();
});

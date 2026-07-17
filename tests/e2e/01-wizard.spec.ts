import { expect, test } from '@playwright/test';
import {
  E2E_PASSWORD,
  STUB_AI_BASE_URL,
  expectDashboard,
  wizardPrimary,
  wizardSkip,
} from './helpers';

test('wizard happy path configures login, AI, checklist, and defaults', async ({ page }) => {
  await page.route('**/api/settings/test/ai', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, message: 'Connected. Looks good!' }),
  }));
  const response = await page.goto('/wizard');
  expect(response?.headers()['content-security-policy']).toContain("'nonce-");
  expect(await page.locator('script[nonce]').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: /let's go/i }).click();

  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(/confirm password/i).fill(E2E_PASSWORD);
  await page.getByLabel(/setup token/i)
    .fill('e2e-setup-token-0123456789abcdef0123456789abcdef');
  await page.getByRole('button', { name: /create password/i }).click();

  await page.getByLabel(/base url/i).fill(STUB_AI_BASE_URL);
  await page.getByLabel(/api key/i).fill('e2e-test-key');
  await page.getByRole('button', { name: /test connection/i }).click();
  await expect(page.getByText(/connected|success|working|looks good/i).first())
    .toBeVisible();
  await page.getByRole('button', { name: /save.*continue/i }).click();

  for (let step = 4; step <= 7; step += 1) {
    await expect(page.getByText(new RegExp(`Step ${step} of 10`))).toBeVisible();
    await wizardSkip(page);
    await expect(page.getByText(new RegExp(`Step ${step + 1} of 10`))).toBeVisible();
  }

  const boxes = page.getByRole('checkbox');
  const count = await boxes.count();
  for (let index = 0; index < count; index += 1) {
    if (index < 2) await boxes.nth(index).check();
    else await boxes.nth(index).uncheck();
  }
  await wizardPrimary(page);
  await wizardPrimary(page);

  await expect(page.getByRole('heading', { name: /Done/ })).toBeVisible();
  await page.getByRole('button', { name: /dashboard/i }).click();
  await expectDashboard(page);
});

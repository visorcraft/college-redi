import { expect, test } from '@playwright/test';
import {
  E2E_PASSWORD,
  STUB_AI_BASE_URL,
  expectDashboard,
  wizardPrimary,
  wizardSkip,
} from './helpers';

test('wizard happy path configures login, AI, checklist, and defaults', async ({ page }) => {
  const response = await page.goto('/');
  await expect(page).toHaveURL(/\/wizard$/);
  expect(response?.headers()['content-security-policy']).toContain("'nonce-");
  expect(await page.locator('script[nonce]').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: /let's go/i }).click();
  await expect(page.getByRole('heading', { name: /your login/i })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /your login/i })).toBeVisible();

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

  for (let step = 4; step <= 6; step += 1) {
    await expect(page.getByText(new RegExp(`Step ${step} of 10`))).toBeVisible();
    await wizardSkip(page);
    await expect(page.getByText(new RegExp(`Step ${step + 1} of 10`))).toBeVisible();
  }

  await page.getByLabel(/audit text/i).fill(
    'DEGREE AUDIT FIXTURE\nBachelor of Science in Computer Science, State University, catalog 2024.',
  );
  await page.getByRole('button', { name: /parse with redi/i }).click();
  await page.getByLabel('Program name').fill('Edited Computer Science');
  await page.getByLabel('Course title CS 101').fill('Computing Foundations');
  await page.getByLabel(/^Requirement subjects/).fill('HUM, PHIL, HIST');
  await page.getByRole('button', { name: /looks right.*import/i }).click();
  await expect(page.getByText('Step 8 of 10')).toBeVisible();

  const boxes = page.getByRole('checkbox');
  const count = await boxes.count();
  for (let index = 0; index < count; index += 1) {
    if (index < 2) await boxes.nth(index).check();
    else await boxes.nth(index).uncheck();
  }
  await wizardPrimary(page);
  await wizardSkip(page);

  await expect(page.getByRole('heading', { name: /Done/ })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'AI brain' }))
    .toContainText('AI brain set up');
  await expect(page.getByRole('listitem').filter({ hasText: 'Your degree' }))
    .toContainText('Your degree set up');
  await expect(page.getByRole('listitem').filter({ hasText: 'Notification style' }))
    .toContainText('Notification style not set up');
  await page.getByRole('button', { name: /dashboard/i }).click();
  await expectDashboard(page);
});

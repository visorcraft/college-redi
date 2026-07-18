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
  await wizardPrimary(page);
  await expect(page.getByRole('heading', { name: /your login/i })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /your login/i })).toBeVisible();

  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(/confirm password/i).fill(E2E_PASSWORD);
  await page.getByLabel(/setup token/i)
    .fill('e2e-setup-token-0123456789abcdef0123456789abcdef');
  await wizardPrimary(page);

  await page.getByLabel(/base url/i).fill(STUB_AI_BASE_URL);
  await page.getByLabel(/api key/i).fill('e2e-test-key');
  await page.getByRole('button', { name: /test connection/i }).click();
  await expect(page.getByText(/connected|success|working|looks good/i).first())
    .toBeVisible();
  const unsavedSettings = await (await page.request.get('/api/settings')).json();
  const unsavedStatus = await (await page.request.get('/api/redi/status')).json();
  expect(unsavedSettings.ai.base_url).not.toBe(STUB_AI_BASE_URL);
  expect(unsavedStatus.aiConfigured).toBe(false);
  await page.getByRole('button', { name: /save.*continue/i }).click();

  await expect(page.getByText('Step 4 of 10')).toBeVisible();
  await page.getByLabel('Host', { exact: true }).fill('imap.school.test');
  await page.getByLabel('Username', { exact: true }).fill('student@school.test');
  await page.getByLabel(/password \/ app password/i).fill('imap-password');
  await wizardPrimary(page);

  await expect(page.getByText('Step 5 of 10')).toBeVisible();
  await page.getByLabel('Host', { exact: true }).fill('smtp.personal.test');
  await page.getByLabel('Username', { exact: true }).fill('student@personal.test');
  await page.getByLabel(/password \/ app password/i).fill('smtp-password');
  await page.getByLabel(/from identity/i).fill('Redi <student@personal.test>');
  await page.getByLabel(/your personal email/i).fill('student@personal.test');
  await wizardPrimary(page);

  await expect(page.getByText('Step 6 of 10')).toBeVisible();
  await page.getByLabel(/account sid/i).fill('AC123456');
  await page.getByLabel(/auth token/i).fill('twilio-token');
  await page.getByLabel(/from-number/i).fill('+15551110000');
  await page.getByLabel(/mobile number/i).fill('+15552220000');
  await wizardPrimary(page);
  await expect(page.getByText('Step 7 of 10')).toBeVisible();

  const savedSettings = await (await page.request.get('/api/settings')).json();
  const savedStatus = await (await page.request.get('/api/redi/status')).json();
  expect(savedSettings.ai.base_url).toBe(STUB_AI_BASE_URL);
  expect(savedStatus.aiConfigured).toBe(true);
  expect(savedSettings.imap.enabled).toBe(true);
  expect(savedSettings.smtp.enabled).toBe(true);
  expect(savedSettings.twilio.enabled).toBe(true);
  const csrf = (await page.context().cookies())
    .find((cookie) => cookie.name === 'redi_csrf')?.value ?? '';
  const disabled = await page.request.patch('/api/settings', {
    data: {
      imap: { enabled: false },
      smtp: { enabled: false },
      twilio: { enabled: false },
    },
    headers: { 'x-csrf-token': csrf },
  });
  expect(disabled.ok()).toBe(true);

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
  await wizardPrimary(page);
  await expectDashboard(page);
});

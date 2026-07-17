import { expect, type Page } from '@playwright/test';

export const E2E_PASSWORD = 'correct horse battery staple';
export const STUB_AI_BASE_URL = 'http://127.0.0.1:3999/v1';

export async function login(page: Page): Promise<void> {
  const response = await page.context().request.post('/api/auth/login', {
    data: { password: E2E_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`login failed: ${response.status()} ${await response.text()}`);
  }
}

export async function wizardPrimary(page: Page): Promise<void> {
  await page.getByRole('button', {
    name: /continue|next|let's go|finish|done|save/i,
  }).first().click();
}

export async function wizardSkip(page: Page): Promise<void> {
  await page.getByRole('button', { name: /skip/i }).first().click();
}

export async function openChat(page: Page): Promise<void> {
  await page.getByTestId('redi-widget').click();
}

export async function expectDashboard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
}

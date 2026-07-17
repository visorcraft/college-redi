import { expect, test } from '@playwright/test';
import { login, openChat } from './helpers';

test('mobile dashboard and chat remain usable', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page.getByTestId('redi-widget')).toBeVisible();
  await openChat(page);
  await expect(page.getByTestId('chat-input')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: /notifications/i }))
    .toBeVisible();
});

import { expect, test } from '@playwright/test';
import { login, openChat } from './helpers';

test('mobile dashboard and chat remain usable', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Registration term' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Degree progress' })).toBeVisible();
  await expect(page.getByTestId('redi-widget')).toBeVisible();
  await openChat(page);
  await expect(page.getByTestId('chat-input')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'College email' }).click();
  await expect(page.getByRole('heading', { name: 'College email' })).toBeVisible();
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBe(width.viewport);
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: /notifications/i }))
    .toBeVisible();
});

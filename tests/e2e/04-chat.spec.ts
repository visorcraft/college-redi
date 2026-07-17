import { expect, test } from '@playwright/test';
import { login, openChat } from './helpers';

test('chat calls a tool and streams Redi’s answer', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await openChat(page);
  await page.getByTestId('chat-input').fill('How is my system doing?');
  await page.getByTestId('chat-send').click();
  await expect(page.getByText(/All systems are green/i))
    .toBeVisible({ timeout: 30_000 });
});

import { expect, test } from '@playwright/test';
import { login, openChat } from './helpers';

test('chat calls a tool and streams Redi’s answer', async ({ page }) => {
  await login(page);
  await page.goto('/');
  const widget = page.getByTestId('redi-widget');
  await widget.focus();
  await openChat(page);
  const input = page.getByTestId('chat-input');
  await expect(input).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Chat with Redi' }))
    .not.toHaveAttribute('aria-modal');
  await input.fill('How is my system doing?');
  await page.getByTestId('chat-send').click();
  await expect(page.getByText(/All systems are green/i))
    .toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(widget).toBeFocused();
});

import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('degree audit import creates a visible program', async ({ page }) => {
  await login(page);
  await page.goto('/degree');
  await page.getByRole('button', { name: /import with redi/i }).click();
  await page.getByLabel(/audit text/i).fill(
    'DEGREE AUDIT FIXTURE\nBachelor of Science in Computer Science, State University, catalog 2024.\nCore: CS 101, CS 201, MATH 151. 6 credits Humanities electives. 120 credits total.',
  );
  await page.getByRole('button', { name: /parse with redi/i }).click();
  await expect(page.getByText(/CS 101/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /looks right.*import/i }).click();
  await expect(page.getByText(/Computer Science/i).first())
    .toBeVisible({ timeout: 15_000 });
});

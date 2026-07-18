import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('degree audit import creates a visible program', async ({ page }) => {
  await login(page);
  await page.goto('/degree');
  await page.getByRole('button', { name: /import (with redi|another audit)/i }).click();
  await page.getByLabel(/audit text/i).fill(
    'DEGREE AUDIT FIXTURE\nBachelor of Science in Computer Science, State University, catalog 2024.\nCore: CS 101, CS 201, MATH 151. 6 credits Humanities electives. 120 credits total.',
  );
  await page.getByRole('button', { name: /parse with redi/i }).click();
  await expect(page.getByLabel('Course title CS 101')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Program name').fill('Edited Computer Science');
  await page.getByLabel('Course title CS 101').fill('Computing Foundations');
  await page.getByRole('button', { name: /looks right.*import/i }).click();
  await expect(page.getByLabel('program', { exact: true }))
    .toContainText('Edited Computer Science', { timeout: 15_000 });
  await expect(page.getByText(/CS 101 · Computing Foundations/))
    .toBeVisible({ timeout: 15_000 });
});

test('degree records can be edited, completed, unmarked, and deleted', async ({ page }) => {
  await login(page);
  await page.goto('/degree');
  await page.getByRole('button', { name: 'Add program' }).click();
  await page.getByLabel('Program name').fill('Certificate in Testing');
  await page.getByLabel('Institution').fill('State University');
  await page.getByLabel('Total credits required').fill('12');
  await page.getByRole('button', { name: 'Create program' }).click();
  await expect(page.getByText('0 / 12 credits')).toBeVisible();

  await page.getByRole('button', { name: 'Edit program' }).click();
  const program = page.getByRole('form', { name: 'edit program details' });
  await program.getByLabel('Program name').fill('Certificate in Software Testing');
  await program.getByRole('button', { name: 'Save program' }).click();
  await expect(page.getByLabel('program', { exact: true })).toContainText('Certificate in Software Testing');

  await page.getByLabel('Course code').fill('QA 101');
  await page.getByLabel('Title').fill('Testing Basics');
  await page.getByLabel('Credits', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Add course' }).click();
  await page.locator('summary').filter({ hasText: 'QA 101 · Testing Basics' }).click();
  const course = page.getByRole('form', { name: 'edit course QA 101' });
  await course.getByLabel('Course title for QA 101').fill('Software Testing Basics');
  await course.getByRole('button', { name: 'Save course' }).click();
  await expect(page.getByText(/QA 101 · Software Testing Basics/)).toBeVisible();

  await page.getByLabel('requirement course').selectOption({ label: 'QA 101' });
  await page.getByLabel('Group').fill('Core');
  await page.getByRole('button', { name: 'Add requirement' }).click();
  await page.locator('summary').filter({ hasText: 'Core · course · QA 101' }).click();
  const requirement = page.getByRole('form', { name: /edit requirement/ });
  await requirement.getByLabel('Group').fill('Required Core');
  await requirement.getByRole('button', { name: 'Save requirement' }).click();
  await expect(page.getByRole('heading', { name: 'Required Core' })).toBeVisible();

  await page.getByLabel('completed course').selectOption({ label: 'QA 101' });
  await page.getByLabel('Term', { exact: true }).fill('Spring');
  await page.getByLabel('Year').fill('2025');
  await page.getByLabel('Grade', { exact: true }).fill('A');
  await page.getByRole('button', { name: 'Mark course' }).click();
  await expect(page.getByText('3 / 12 credits')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'unmark QA 101 Spring 2025' }).click();
  await expect(page.getByText('0 / 12 credits')).toBeVisible();

  await page.locator('summary').filter({ hasText: 'Required Core · course · QA 101' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete requirement' }).click();
  await page.locator('summary').filter({ hasText: 'QA 101 · Software Testing Basics' }).click();
  let releaseStalePrograms!: () => void;
  let staleProgramsCaptured!: () => void;
  let staleProgramsFinished!: () => void;
  const releaseStale = new Promise<void>((resolve) => { releaseStalePrograms = resolve; });
  const staleCaptured = new Promise<void>((resolve) => { staleProgramsCaptured = resolve; });
  const staleFinished = new Promise<void>((resolve) => { staleProgramsFinished = resolve; });
  await page.route('**/api/programs', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    staleProgramsCaptured();
    await releaseStale;
    await route.fulfill({ response });
    staleProgramsFinished();
  }, { times: 1 });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete course' }).click();
  await staleCaptured;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete program' }).click();
  await expect(page.getByLabel('program', { exact: true })).not.toContainText('Certificate in Software Testing');
  releaseStalePrograms();
  await staleFinished;
  await expect(page.getByLabel('program', { exact: true })).not.toContainText('Certificate in Software Testing');
});

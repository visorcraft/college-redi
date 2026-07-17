import { expect, test } from '@playwright/test';

const PASSWORD = 'correct horse battery';

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: process.env.REDI_BASE_URL ?? 'http://127.0.0.1:3100' });
  await request.post('/api/auth/setup', { data: { password: PASSWORD } }); // 400 if already set — fine
  await request.dispose();
});

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { password: PASSWORD } });
});

test('student can build a program, plan a course, and see progress', async ({ page }) => {
  await page.goto('/degree');
  await expect(page.getByRole('heading', { name: 'My Degree' })).toBeVisible();

  await page.getByRole('button', { name: 'Add program manually' }).click();
  await page.getByLabel('Program name').fill('BS Computer Science');
  await page.getByLabel('Institution').fill('State University');
  await page.getByLabel('Total credits required').fill('120');
  await page.getByRole('button', { name: 'Create program' }).click();
  await expect(page.getByText('0 / 120 credits')).toBeVisible();

  await page.getByLabel('Course code').fill('CS 101');
  await page.getByLabel('Title').fill('Intro to CS');
  await page.getByLabel('Credits', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Add course' }).click();
  await expect(page.getByLabel('requirement course')).toContainText('CS 101');

  await page.getByLabel('requirement type').selectOption('course');
  await page.getByLabel('requirement course').selectOption({ label: 'CS 101' });
  await page.getByLabel('Group').fill('Core');
  await page.getByRole('button', { name: 'Add requirement' }).click();
  await expect(page.getByText('Required course')).toBeVisible();

  await page.getByLabel('Term name').fill('Fall 2026');
  await page.getByLabel('Classes start').fill('2026-08-24');
  await page.getByLabel('Classes end').fill('2026-12-11');
  await page.getByRole('button', { name: 'Add term' }).click();
  await expect(page.getByText('Fall 2026')).toBeVisible();

  await page.getByLabel('course to plan for Fall 2026').selectOption({ label: 'CS 101' });
  await page.getByRole('button', { name: 'Plan' }).click();
  await expect(page.getByLabel('status for CS 101')).toHaveValue('planned');
  await expect(page.getByText('Projected graduation: Fall 2026')).toBeVisible();
});

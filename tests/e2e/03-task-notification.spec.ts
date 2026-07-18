import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('task creation and cron tick produce an in-app reminder', async ({ page }) => {
  await login(page);
  await page.goto('/tasks');
  await page.getByLabel(/task title/i).fill('Pay housing deposit');
  await page.getByLabel('Description').fill('Submit the deposit receipt to Housing.');
  await page.getByLabel('Override default reminders').check();
  await page.getByLabel('Days before due').fill('5, 1, 0');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Pay housing deposit')).toBeVisible();
  await expect(page.getByText('Submit the deposit receipt to Housing.')).toBeVisible();
  await expect(page.getByText(/Custom reminders: 5, 1, 0/)).toBeVisible();

  await page.getByRole('link', { name: 'Search' }).click();
  await page.getByLabel('Search Redi').fill('housing deposit');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Pay housing deposit', { exact: true })).toBeVisible();
  await page.goto('/tasks');

  let card = page.getByRole('listitem').filter({ hasText: 'Pay housing deposit' });
  await card.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('form', { name: 'edit Pay housing deposit' });
  await edit.getByLabel('Title').fill('Pay housing deposit online');
  await edit.getByLabel('Description').fill('Upload the receipt after payment.');
  await edit.getByRole('button', { name: 'Save task' }).click();
  card = page.getByRole('listitem').filter({ hasText: 'Pay housing deposit online' });
  await expect(card.getByText('Upload the receipt after payment.')).toBeVisible();
  await card.getByRole('button', { name: 'Done' }).click();
  const history = page.getByRole('region', { name: 'task history' });
  const historyCard = history.getByRole('listitem')
    .filter({ hasText: 'Pay housing deposit online' });
  await expect(historyCard).toBeVisible();
  await expect(historyCard.getByText('completed', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await historyCard.getByRole('button', { name: 'Delete' }).click();
  await expect(history.getByText('Pay housing deposit online')).toHaveCount(0);

  const csrf = (await page.context().cookies())
    .find((cookie) => cookie.name === 'redi_csrf')?.value ?? '';
  const settings = await page.context().request.patch('/api/settings', {
    data: { quiet_hours: { start: '00:00', end: '00:00' } },
    headers: { 'x-csrf-token': csrf },
  });
  expect(settings.ok()).toBeTruthy();
  const created = await page.context().request.post('/api/tasks', {
    data: {
      title: 'Advising appointment',
      due_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: { 'x-csrf-token': csrf },
  });
  expect(created.ok()).toBeTruthy();

  const tick = await page.context().request.post('/api/cron/tick', {
    headers: { 'X-Redi-Cron-Secret': 'e2e-cron-secret' },
  });
  expect(tick.ok()).toBeTruthy();

  await page.goto('/notifications');
  await expect(page.getByText(/Advising appointment/i).first())
    .toBeVisible({ timeout: 10_000 });

  const reminder = page.getByRole('region', { name: 'Schedule a reminder' });
  await reminder.getByLabel('Title').fill('Call financial aid');
  await reminder.getByLabel('When')
    .fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  await reminder.getByLabel('Message').fill('Ask whether the FAFSA was received.');
  await reminder.getByLabel('In app').uncheck();
  await reminder.getByRole('button', { name: 'Schedule reminder' }).click();
  await expect(reminder.getByRole('status'))
    .toHaveText('Choose at least one delivery channel.');
  await reminder.getByLabel('In app').check();
  await reminder.getByRole('button', { name: 'Schedule reminder' }).click();
  await expect(reminder.getByRole('status')).toHaveText('Reminder scheduled.');
});

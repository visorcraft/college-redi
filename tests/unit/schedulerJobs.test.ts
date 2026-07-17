import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { cleanTables, setupTestDb, teardownTestDb } from '../helpers/p4';

const cronMock = vi.hoisted(() => ({
  schedule: vi.fn((_expression: string, _handler: () => void, _options?: unknown) => ({ stop: vi.fn() })),
}));
vi.mock('node-cron', () => ({ default: { schedule: cronMock.schedule } }));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn(async () => ({ messageId: 'm' })) })) },
}));
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: vi.fn(async () => ({ sid: 'S' })) } })),
}));

const NOW = new Date('2026-08-20T12:00:00.000Z');

let jobs: typeof import('../../src/server/notify/jobs');
let scheduler: typeof import('../../src/server/scheduler');
let callTool: (n: string, p: unknown, c: { actor: string }) => Promise<unknown>;
let updateSettings: (p: Record<string, unknown>) => Promise<unknown>;
let sqlRows: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;
let sqlExec: (sql: string) => Promise<void>;

const notesOf = (type: string) =>
  sqlRows<{ title: string; importance: string }>(
    `SELECT title, importance FROM notifications WHERE type = '${type}'`,
  );

beforeAll(async () => {
  await setupTestDb();
  jobs = await import('../../src/server/notify/jobs');
  scheduler = await import('../../src/server/scheduler');
  ({ callTool } = await import('../../src/server/tools/call'));
  ({ updateSettings } = await import('../../src/server/settings'));
  ({ sqlRows, sqlExec } = await import('../../src/server/db/sql'));
});
beforeEach(async () => {
  await cleanTables();
  cronMock.schedule.mockClear();
  await updateSettings({
    timezone: 'UTC',
    quiet_hours: { start: '22:00', end: '08:00' },
    notification_prefs: {},
  });
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  scheduler.stopScheduler();
  vi.useRealTimers();
});
afterAll(teardownTestDb);

describe('task reminders (spec §6.3, generated inside the per-minute dispatch tick)', () => {
  it('enqueues a reminder for a task due in 1 day and dedupes the same day', async () => {
    await callTool('create_task', {
      title: 'Pay tuition deposit', category: 'payment', due_at: '2026-08-21',
    }, { actor: 'test' });
    expect((await jobs.runNotificationDispatchJob(NOW)).reminders_enqueued).toBe(1);
    expect((await notesOf('task_reminder'))[0]).toMatchObject({ importance: 'normal' });
    expect((await notesOf('task_reminder'))[0]?.title).toContain('Pay tuition deposit');
    expect((await jobs.runNotificationDispatchJob(NOW)).reminders_enqueued).toBe(0);
    expect(await notesOf('task_reminder')).toHaveLength(1);
  });

  it('re-nags an awaiting_confirmation task after 7 days at low importance', async () => {
    const t = await callTool('create_task', { title: 'Transcript' }, { actor: 'test' }) as { id: string };
    await sqlExec(
      `UPDATE tasks SET status = 'awaiting_confirmation', updated_at = '2026-08-10T12:00:00.000Z' WHERE id = '${t.id}'`,
    );
    expect((await jobs.enqueueDueTaskReminders(NOW)).enqueued).toBe(1);
    expect((await notesOf('task_reminder'))[0]).toMatchObject({ importance: 'low' });
    expect((await notesOf('task_reminder'))[0]?.title).toContain('Still waiting');
  });
});

describe('daily digest (spec §6.5.2)', () => {
  it('is skipped when empty and when digest_enabled is false', async () => {
    expect(await jobs.runDailyDigestJob(NOW)).toEqual({ sent: false, reason: 'empty' });
    await callTool('create_task', {
      title: 'Due today thing', due_at: '2026-08-20',
    }, { actor: 'test' });
    await updateSettings({ notification_prefs: { digest_enabled: false } });
    expect(await jobs.runDailyDigestJob(NOW)).toEqual({ sent: false, reason: 'digest_disabled' });
    expect(await notesOf('digest')).toHaveLength(0);
  });

  it('composes due-today + upcoming-week tasks into one notification', async () => {
    await updateSettings({
      notification_prefs: { digest_enabled: true },
      smtp: { enabled: true, host: 'smtp.example.com', personal_email: 'me@example.com' },
    });
    await callTool('create_task', {
      title: 'Due today thing', due_at: '2026-08-20',
    }, { actor: 'test' });
    await callTool('create_task', {
      title: 'Next week thing', due_at: '2026-08-25',
    }, { actor: 'test' });
    expect(await jobs.runDailyDigestJob(NOW)).toEqual({ sent: true });
    const rows = await sqlRows<{ body: string; channels: string }>(
      `SELECT body, channels FROM notifications WHERE type = 'digest'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toContain('Due today thing');
    expect(rows[0]?.body).toContain('Next week thing');
    expect(rows[0]?.channels).toBe('["in_app","email"]');
  });
});

describe('registration sweep (spec §6.2, Appendix C hourly)', () => {
  const seedTerm = (over: Record<string, string | null> = {}) => {
    const t = {
      registration_opens_at: '2026-08-26T12:00:00.000Z',
      registration_closes_at: '2026-09-10T12:00:00.000Z',
      add_drop_deadline: '2026-09-15T12:00:00.000Z',
      tuition_due: '2026-08-21T12:00:00.000Z',
      ...over,
    };
    const q = (v: string | null) => (v ? `'${v}'` : 'NULL');
    return sqlExec(`INSERT INTO terms (id, name, classes_start, classes_end, registration_opens_at, registration_closes_at, add_drop_deadline, tuition_due, notes) VALUES ('term-1', 'Fall 2026', '2026-09-01', '2026-12-15', ${q(t.registration_opens_at)}, ${q(t.registration_closes_at)}, ${q(t.add_drop_deadline)}, ${q(t.tuition_due)}, NULL)`);
  };
  const seedPlan = () => sqlExec(`INSERT INTO planned_courses (id, program_id, course_id, term_id, status, section, notes, created_at, updated_at) VALUES ('pc-1', 'prog-1', 'course-1', 'term-1', 'planned', NULL, NULL, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`);

  it('reminds 7d before registration opens when courses are unregistered (+ tuition 1d); dedupes; no-ops when empty', async () => {
    expect(await jobs.runRegistrationSweepJob(NOW)).toEqual({ enqueued: 0 });
    await seedTerm();
    await seedPlan();
    expect((await jobs.runRegistrationSweepJob(NOW)).enqueued).toBe(2);
    expect((await notesOf('registration_window'))[0]?.title).toContain('Fall 2026');
    expect((await jobs.runRegistrationSweepJob(NOW)).enqueued).toBe(0);
    expect(await notesOf('deadline_reminder')).toHaveLength(1);
  });

  it('sends the weekly reminder during the open window', async () => {
    await seedTerm({ registration_opens_at: '2026-08-19T12:00:00.000Z' });
    await seedPlan();
    await jobs.runRegistrationSweepJob(NOW);
    expect((await notesOf('registration_window'))
      .some((n) => n.title.includes('still have 1 unregistered'))).toBe(true);
  });
});

describe('scheduler registration (Appendix C) and job_leases (spec §3.4)', () => {
  it('registers dispatch/sweep/digest cron jobs; SCHEDULER_ENABLED=false registers none', async () => {
    delete process.env.SCHEDULER_ENABLED;
    await scheduler.startScheduler();
    expect(cronMock.schedule.mock.calls.map((c) => c[0]))
      .toEqual(['* * * * *', '7 * * * *', '* * * * *', '17 * * * *']);
    scheduler.stopScheduler();
    cronMock.schedule.mockClear();
    process.env.SCHEDULER_ENABLED = 'false';
    await scheduler.startScheduler();
    expect(cronMock.schedule).not.toHaveBeenCalled();
    delete process.env.SCHEDULER_ENABLED;
  });

  it('reads digest time and timezone on every tick', async () => {
    expect(await scheduler.runDailyDigestIfDue(
      new Date('2026-08-20T12:30:00.000Z'),
    )).toEqual({ skipped: true });
    await updateSettings({
      timezone: 'America/Chicago',
      notification_prefs: { digest_time: '07:30' },
    });
    expect(await scheduler.runDailyDigestIfDue(
      new Date('2026-08-20T12:30:00.000Z'),
    )).toMatchObject({ skipped: false });
  });

  it('withLease skips a job whose lease is still held and records last_status', async () => {
    const fn = vi.fn(async () => undefined);
    await scheduler.withLease('test_job', 3_600_000, fn);
    expect(await scheduler.withLease('test_job', 3_600_000, fn)).toEqual({ skipped: true });
    expect(fn).toHaveBeenCalledTimes(1);
    expect((await sqlRows<{ last_status: string }>(
      `SELECT last_status FROM job_leases WHERE job_name = 'test_job'`,
    ))[0]?.last_status).toBe('ok');
  });
});

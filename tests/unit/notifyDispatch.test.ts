import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { cleanTables, setupTestDb, teardownTestDb } from '../helpers/p4';

const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), smsCreate: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mocks.sendMail })) },
}));
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: mocks.smsCreate } })),
}));

let engine: typeof import('../../src/server/notify/engine');
let updateSettings: (p: Record<string, unknown>) => Promise<unknown>;
let sqlRows: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;

const T0 = new Date('2026-03-10T12:00:00.000Z');

beforeAll(async () => {
  await setupTestDb();
  engine = await import('../../src/server/notify/engine');
  ({ updateSettings } = await import('../../src/server/settings'));
  ({ sqlRows } = await import('../../src/server/db/sql'));
});
beforeEach(async () => {
  await cleanTables();
  mocks.sendMail.mockReset().mockResolvedValue({ messageId: 'msg-1' });
  mocks.smsCreate.mockReset().mockResolvedValue({ sid: 'SM1' });
  await updateSettings({
    timezone: 'UTC',
    quiet_hours: { start: '22:00', end: '08:00' },
    notification_prefs: {},
    smtp: {
      enabled: true, host: 'smtp.example.com', port: 465, security: 'tls',
      username: 'u', from_address: 'redi@example.com', personal_email: 'me@example.com',
    },
    twilio: { enabled: true, account_sid: 'AC1', from_number: '+1000', to_number: '+1555' },
  });
});
afterAll(teardownTestDb);

const historyFor = (id: string) =>
  sqlRows<{ channel: string; status: string; attempt: number }>(
    `SELECT channel, status, attempt FROM notification_history WHERE notification_id = '${id}' ORDER BY attempt ASC, channel ASC`,
  );

describe('dispatchDueNotifications (spec §6.5.2)', () => {
  it('delivers every resolved channel, writes history, and marks the notification sent', async () => {
    const id = await engine.enqueueNotification({
      type: 'system', title: 'Hi', body: 'b', importance: 'urgent', scheduledFor: T0,
    });
    expect((await engine.dispatchDueNotifications(new Date(T0.getTime() + 1000))).sent).toBe(1);
    expect((await historyFor(id)).map((h) => `${h.channel}:${h.status}`))
      .toEqual(['email:sent', 'in_app:sent', 'sms:sent']);
    expect(mocks.sendMail).toHaveBeenCalledOnce();
    expect(mocks.smsCreate).toHaveBeenCalledOnce();
    expect((await sqlRows<{ status: string; sent_at: string | null }>(
      `SELECT status, sent_at FROM notifications WHERE id = '${id}'`,
    ))[0]).toMatchObject({ status: 'sent', sent_at: expect.any(String) });
  });

  it('retries a failed channel only after its 1m backoff, then succeeds', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const id = await engine.enqueueNotification({
      type: 'system', title: 'Hi', body: 'b', importance: 'normal', scheduledFor: T0,
    });
    expect((await engine.dispatchDueNotifications(T0)).awaiting_retry).toBe(1);
    expect((await historyFor(id)).map((h) => `${h.channel}:${h.status}`))
      .toEqual(['email:failed', 'in_app:sent']);
    expect((await engine.dispatchDueNotifications(new Date(T0.getTime() + 30_000))).awaiting_retry).toBe(1);
    expect(await historyFor(id)).toHaveLength(2);
    expect((await engine.dispatchDueNotifications(new Date(T0.getTime() + 61_000))).sent).toBe(1);
    expect((await historyFor(id)).map((h) => `${h.channel}:${h.status}`))
      .toEqual(['email:failed', 'in_app:sent', 'email:sent']);
  });

  it('marks failed after the initial attempt plus 3 retries (1m/15m/1h) all fail', async () => {
    mocks.sendMail.mockRejectedValue(new Error('smtp down'));
    const id = await engine.enqueueNotification({
      type: 'system',
      title: 'Hi',
      body: 'b',
      importance: 'normal',
      channels: ['email'],
      scheduledFor: T0,
    });
    const at = (ms: number) => new Date(T0.getTime() + ms);
    await engine.dispatchDueNotifications(T0);
    await engine.dispatchDueNotifications(at(2 * 60_000));
    await engine.dispatchDueNotifications(at(18 * 60_000));
    expect((await engine.dispatchDueNotifications(at(80 * 60_000))).failed).toBe(1);
    const history = await historyFor(id);
    expect(history).toHaveLength(4);
    expect(history.every((h) => h.status === 'failed')).toBe(true);
    expect((await sqlRows<{ status: string }>(
      `SELECT status FROM notifications WHERE id = '${id}'`,
    ))[0]?.status).toBe('failed');
  });

  it('holds non-urgent deliveries inside quiet hours and flushes them at quiet end', async () => {
    const id = await engine.enqueueNotification({
      type: 'system',
      title: 'Hi',
      body: 'b',
      importance: 'normal',
      channels: ['in_app'],
      scheduledFor: new Date('2026-03-10T21:00:00.000Z'),
    });
    expect((await engine.dispatchDueNotifications(new Date('2026-03-10T23:30:00.000Z'))).held).toBe(1);
    expect(await historyFor(id)).toHaveLength(0);
    expect((await sqlRows<{ scheduled_for: string }>(
      `SELECT scheduled_for FROM notifications WHERE id = '${id}'`,
    ))[0]?.scheduled_for).toBe('2026-03-11T08:00:00.000Z');
    expect((await engine.dispatchDueNotifications(new Date('2026-03-11T08:00:01.000Z'))).sent).toBe(1);
  });
});

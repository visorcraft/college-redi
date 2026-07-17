import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { cleanTables, setupTestDb, teardownTestDb } from '../helpers/p4';

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  smsCreate: vi.fn(),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: mocks.createTransport },
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
  mocks.createTransport.mockReset().mockReturnValue({ sendMail: mocks.sendMail });
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
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      mocks.sendMail.mockRejectedValueOnce(new Error('smtp down'));
      const id = await engine.enqueueNotification({
        type: 'system', title: 'Hi', body: 'b', importance: 'normal', scheduledFor: T0,
      });
      expect((await engine.dispatchDueNotifications(T0)).awaiting_retry).toBe(1);
      expect((await historyFor(id)).map((h) => `${h.channel}:${h.status}`))
        .toEqual(['email:failed', 'in_app:sent']);
      vi.setSystemTime(new Date(T0.getTime() + 30_000));
      expect((await engine.dispatchDueNotifications(new Date())).awaiting_retry).toBe(1);
      expect(await historyFor(id)).toHaveLength(2);
      vi.setSystemTime(new Date(T0.getTime() + 61_000));
      expect((await engine.dispatchDueNotifications(new Date())).sent).toBe(1);
      expect((await historyFor(id)).map((h) => `${h.channel}:${h.status}`))
        .toEqual(['email:failed', 'in_app:sent', 'email:sent']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks failed after the initial attempt plus 3 retries (1m/15m/1h) all fail', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
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
      vi.setSystemTime(at(2 * 60_000));
      await engine.dispatchDueNotifications(new Date());
      vi.setSystemTime(at(18 * 60_000));
      await engine.dispatchDueNotifications(new Date());
      vi.setSystemTime(at(80 * 60_000));
      expect((await engine.dispatchDueNotifications(new Date())).failed).toBe(1);
      const history = await historyFor(id);
      expect(history).toHaveLength(4);
      expect(history.every((h) => h.status === 'failed')).toBe(true);
      expect((await sqlRows<{ status: string }>(
        `SELECT status FROM notifications WHERE id = '${id}'`,
      ))[0]?.status).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
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

  it('claims each channel while delivery is in flight', async () => {
    let finish!: (value: { messageId: string }) => void;
    let started!: () => void;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.sendMail.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve;
      started();
    }));
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const id = await engine.enqueueNotification({
        type: 'system',
        title: 'Hi',
        body: 'b',
        importance: 'normal',
        channels: ['email'],
        scheduledFor: T0,
      });
      const first = engine.dispatchDueNotifications(T0);
      await sending;
      await vi.advanceTimersByTimeAsync(11 * 60_000);
      await engine.dispatchDueNotifications(new Date());
      expect(mocks.sendMail).toHaveBeenCalledOnce();
      finish({ messageId: 'msg-1' });
      expect((await first).sent).toBe(1);
      expect(await historyFor(id)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends quiet hours at the first valid instant after a DST gap', () => {
    expect(engine.quietHoursEnd(
      new Date('2026-03-08T07:30:00.000Z'),
      { start: '22:00', end: '02:30' },
      'America/Chicago',
    ).toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });

  it('requires TLS upgrade for STARTTLS delivery', async () => {
    await updateSettings({ smtp: { security: 'starttls', port: 587 } });
    await engine.enqueueNotification({
      type: 'system',
      title: 'Hi',
      body: 'b',
      importance: 'normal',
      channels: ['email'],
      scheduledFor: T0,
    });
    await engine.dispatchDueNotifications(T0);
    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, requireTLS: true }),
    );
  });
});

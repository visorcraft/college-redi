import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { cleanTables, setupTestDb, teardownTestDb } from '../helpers/p4';

let engine: typeof import('../../src/server/notify/engine');
let updateSettings: (p: Record<string, unknown>) => Promise<unknown>;
let sqlRows: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;

const SMTP = {
  smtp: {
    enabled: true, host: 'smtp.example.com', port: 465, security: 'tls',
    username: 'u', from_address: 'redi@example.com', personal_email: 'me@example.com',
  },
};
const TWILIO = {
  twilio: { enabled: true, account_sid: 'AC1', from_number: '+1000', to_number: '+1555' },
};

beforeAll(async () => {
  await setupTestDb();
  engine = await import('../../src/server/notify/engine');
  ({ updateSettings } = await import('../../src/server/settings'));
  ({ sqlRows } = await import('../../src/server/db/sql'));
});
beforeEach(async () => {
  await cleanTables();
  await updateSettings({
    timezone: 'UTC',
    quiet_hours: { start: '22:00', end: '08:00' },
    notification_prefs: {},
    ...SMTP,
    ...TWILIO,
  });
});
afterAll(teardownTestDb);

describe('resolveChannels routing matrix (spec §6.5.2)', () => {
  it('maps importance to default channels; explicit channels override the map', async () => {
    const s = await engine.loadEngineSettings();
    expect(engine.resolveChannels('urgent', s)).toEqual(['in_app', 'email', 'sms']);
    expect(engine.resolveChannels('normal', s)).toEqual(['in_app', 'email']);
    expect(engine.resolveChannels('low', s)).toEqual(['in_app']);
    expect(engine.resolveChannels('normal', s, ['sms'])).toEqual(['sms']);
  });

  it('degrades to configured channels only, keeping in_app as the floor', async () => {
    await updateSettings({ smtp: { enabled: false }, twilio: { enabled: false } });
    const s = await engine.loadEngineSettings();
    expect(engine.resolveChannels('urgent', s)).toEqual(['in_app']);
    expect(engine.resolveChannels('normal', s, ['sms'])).toEqual(['in_app']);
  });

  it('requires both Twilio sender and destination numbers', () => {
    expect(engine.twilioConfigured({
      twilio: {
        enabled: true,
        account_sid: 'AC1',
        to_number: '+1555',
      },
    })).toBe(false);
  });
});

describe('applyQuietHours boundary (spec §6.5.2)', () => {
  it('holds non-urgent inside quiet hours until quiet end; urgent passes', async () => {
    const s = await engine.loadEngineSettings();
    expect(engine.applyQuietHours(new Date('2026-03-10T23:30:00.000Z'), 'normal', s).toISOString())
      .toBe('2026-03-11T08:00:00.000Z');
    expect(engine.applyQuietHours(new Date('2026-03-10T23:30:00.000Z'), 'urgent', s).toISOString())
      .toBe('2026-03-10T23:30:00.000Z');
    expect(engine.applyQuietHours(new Date('2026-03-10T07:59:00.000Z'), 'low', s).toISOString())
      .toBe('2026-03-10T08:00:00.000Z');
    expect(engine.applyQuietHours(new Date('2026-03-10T08:00:00.000Z'), 'normal', s).toISOString())
      .toBe('2026-03-10T08:00:00.000Z');
    expect(engine.applyQuietHours(new Date('2026-03-10T12:00:00.000Z'), 'normal', s).toISOString())
      .toBe('2026-03-10T12:00:00.000Z');
  });
});

describe('enqueueNotification (contract signature)', () => {
  it('persists a pending row with resolved channels and quiet-adjusted schedule; returns the id', async () => {
    const id = await engine.enqueueNotification({
      type: 'system',
      title: 'Hello',
      body: 'world',
      importance: 'normal',
      scheduledFor: new Date('2026-03-10T23:30:00.000Z'),
      relatedType: 'task',
      relatedId: 't1',
    });
    const rows = await sqlRows<Record<string, unknown>>(`SELECT * FROM notifications WHERE id = '${id}'`);
    expect(rows[0]).toMatchObject({
      type: 'system',
      importance: 'normal',
      status: 'pending',
      channels: '["in_app","email"]',
      scheduled_for: '2026-03-11T08:00:00.000Z',
      related_type: 'task',
      related_id: 't1',
      sent_at: null,
    });
    const id2 = await engine.enqueueNotification({
      type: 'task_reminder',
      title: 't',
      body: 'b',
      importance: 'urgent',
      scheduledFor: new Date('2026-03-10T12:00:00.000Z'),
    });
    expect((await sqlRows<{ channels: string }>(
      `SELECT channels FROM notifications WHERE id = '${id2}'`,
    ))[0]?.channels).toBe('["in_app","email","sms"]');
  });
});

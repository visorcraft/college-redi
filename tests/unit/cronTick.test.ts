import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanTables, setupTestDb, teardownTestDb } from '../helpers/p4';

vi.mock('../../src/server/password', () => ({
  verifyPassword: vi.fn(async (hash: string, value: string) =>
    hash === 'stored-hash' && value === 'right-secret'),
}));

let POST: (req: NextRequest) => Promise<Response>;
let setSecret: (name: string, value: string) => Promise<void>;
let enqueue: typeof import('../../src/server/notify/engine').enqueueNotification;
let updateSettings: (patch: Record<string, unknown>) => Promise<unknown>;
let sqlExec: (sql: string) => Promise<void>;
let sqlRows: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;

const request = (secret?: string) => new NextRequest('http://localhost/api/cron/tick', {
  method: 'POST',
  headers: secret ? { 'x-redi-cron-secret': secret } : {},
});

beforeAll(async () => {
  await setupTestDb();
  ({ POST } = await import('../../src/app/api/cron/tick/route'));
  ({ setSecret } = await import('../../src/server/secrets'));
  ({ enqueueNotification: enqueue } = await import('../../src/server/notify/engine'));
  ({ updateSettings } = await import('../../src/server/settings'));
  ({ sqlExec, sqlRows } = await import('../../src/server/db/sql'));
  await updateSettings({
    timezone: 'UTC',
    quiet_hours: { start: '22:00', end: '08:00' },
    notification_prefs: {},
  });
});
beforeEach(async () => {
  await cleanTables();
  await sqlExec('DELETE FROM secrets');
});
afterAll(teardownTestDb);

describe('POST /api/cron/tick', () => {
  it('returns 401 with a missing or wrong secret', async () => {
    await setSecret('cron.secret_hash', 'stored-hash');
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request('wrong'))).status).toBe(401);
  });

  it('returns 401 when no cron secret is configured', async () => {
    expect((await POST(request('right-secret'))).status).toBe(401);
  });

  it('runs one dispatch tick while the in-process scheduler is disabled', async () => {
    await setSecret('cron.secret_hash', 'stored-hash');
    process.env.SCHEDULER_ENABLED = 'false';
    await enqueue({
      type: 'system',
      title: 'hello',
      body: 'b',
      importance: 'urgent',
      scheduledFor: new Date(Date.now() - 60_000),
    });
    const res = await POST(request('right-secret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      ran: ['notification_dispatch'],
      sent: 1,
    });
    expect((await sqlRows<{ actor: string; tool_name: string }>(
      `SELECT actor, tool_name FROM audit_log WHERE tool_name = 'cron_tick'`,
    ))[0]).toEqual({ actor: 'cron', tool_name: 'cron_tick' });
  });

  it('reports dispatch failure and audits it as failed', async () => {
    await setSecret('cron.secret_hash', 'stored-hash');
    const id = await enqueue({
      type: 'system',
      title: 'hello',
      body: 'b',
      importance: 'urgent',
      scheduledFor: new Date(Date.now() - 60_000),
    });
    await sqlExec(`UPDATE notifications SET channels = 'not-json' WHERE id = '${id}'`);
    const res = await POST(request('right-secret'));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false });
    const audit = (await sqlRows<{ detail: string }>(
      `SELECT detail FROM audit_log WHERE tool_name = 'cron_tick' ORDER BY created_at DESC LIMIT 1`,
    ))[0];
    expect(JSON.parse(audit?.detail ?? '{}')).toMatchObject({ ok: false });
  });
});

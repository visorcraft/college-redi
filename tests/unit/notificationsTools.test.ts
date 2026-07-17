import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanTables, setupTestDb, teardownTestDb } from '../helpers/p4';

const CTX = { actor: 'test' };
let callTool: (name: string, params: unknown, context: { actor: string }) => Promise<unknown>;
let enqueue: typeof import('../../src/server/notify/engine').enqueueNotification;
let updateSettings: (patch: Record<string, unknown>) => Promise<unknown>;
let sqlExec: (sql: string) => Promise<void>;

interface ListResult {
  notifications: Array<{ id: string; title: string; read: boolean; status: string }>;
  unread_count: number;
}

beforeAll(async () => {
  await setupTestDb();
  ({ callTool } = await import('../../src/server/tools/call'));
  ({ enqueueNotification: enqueue } = await import('../../src/server/notify/engine'));
  ({ updateSettings } = await import('../../src/server/settings'));
  ({ sqlExec } = await import('../../src/server/db/sql'));
  await updateSettings({
    timezone: 'UTC',
    quiet_hours: { start: '22:00', end: '08:00' },
    notification_prefs: {},
  });
});
beforeEach(cleanTables);
afterAll(teardownTestDb);

const seed = (title: string) => enqueue({
  type: 'system',
  title,
  body: 'b',
  importance: 'normal',
  scheduledFor: new Date(Date.now() - 60_000),
});

describe('notification tools', () => {
  it('lists newest first with unread count and filtering', async () => {
    await seed('one');
    await seed('two');
    const all = await callTool('list_notifications', {}, CTX) as ListResult;
    expect(all.notifications.map((item) => item.title)).toEqual(['two', 'one']);
    expect(all.unread_count).toBe(2);
    await callTool('mark_notification_read', { id: all.notifications[0]!.id }, CTX);
    const unread = await callTool(
      'list_notifications',
      { unread_only: true },
      CTX,
    ) as ListResult;
    expect(unread.notifications.map((item) => item.title)).toEqual(['one']);
    expect(unread.unread_count).toBe(1);
  });

  it('404s a missing id and marks all notifications read', async () => {
    await seed('a');
    await seed('b');
    await expect(callTool(
      'mark_notification_read',
      { id: 'nope' },
      CTX,
    )).rejects.toThrow(/not found/i);
    const result = await callTool('mark_all_notifications_read', {}, CTX) as { marked: number };
    expect(result.marked).toBe(2);
    expect((await callTool('list_notifications', {}, CTX) as ListResult).unread_count).toBe(0);
  });

  it('masks destinations in notification history', async () => {
    const notificationId = await seed('x');
    await sqlExec(
      `INSERT INTO notification_history (` +
      `id, notification_id, channel, destination, status, provider_response, attempt, sent_at` +
      `) VALUES (` +
      `'h1', '${notificationId}', 'email', 'testuser@example.com', 'sent', ` +
      `'{"messageId":"m1"}', 1, '2026-03-10T12:00:00.000Z')`,
    );
    const rows = await callTool('get_notification_history', {}, CTX) as Array<{
      destination: string;
      notification_title: string;
      provider_response: { messageId: string };
    }>;
    expect(rows[0]?.destination).toBe('te***@example.com');
    expect(rows[0]?.notification_title).toBe('x');
    expect(rows[0]?.provider_response.messageId).toBe('m1');
  });

  it('schedules an ad-hoc reminder', async () => {
    const result = await callTool('schedule_notification', {
      title: 'Email my advisor',
      body: 'Ask about CS 201',
      scheduled_for: '2026-03-13T15:00:00.000Z',
    }, CTX) as { id: string };
    expect(result.id).toBeTruthy();
    const list = await callTool('list_notifications', {}, CTX) as ListResult;
    expect(list.notifications[0]?.title).toBe('Email my advisor');
  });

  it('exposes list and mark-all REST adapters', async () => {
    await seed('via-rest');
    const route = await import('../../src/app/api/notifications/route');
    const readAll = await import('../../src/app/api/notifications/read-all/route');
    const res = await route.GET(new NextRequest('http://localhost/api/notifications'));
    expect((await res.json() as ListResult).unread_count).toBe(1);
    const marked = await readAll.POST();
    expect((await marked.json() as { marked: number }).marked).toBe(1);
  });
});

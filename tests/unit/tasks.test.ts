import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanTables, setupTestDb, teardownTestDb } from '../helpers/p4';

const CTX = { actor: 'test' };
let callTool: (name: string, params: unknown, context: { actor: string }) => Promise<unknown>;
let sqlRows: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;
let sqlExec: (sql: string) => Promise<void>;
let withSqlTransaction: <T>(fn: () => Promise<T>) => Promise<T>;
let updateSettings: (patch: Record<string, unknown>) => Promise<unknown>;

beforeAll(async () => {
  await setupTestDb();
  ({ callTool } = await import('../../src/server/tools/call'));
  ({ sqlRows, sqlExec, withSqlTransaction } = await import('../../src/server/db/sql'));
  ({ updateSettings } = await import('../../src/server/settings'));
});
beforeEach(async () => {
  await cleanTables();
  await updateSettings({ timezone: 'UTC' });
});
afterAll(teardownTestDb);

interface TaskDto {
  id: string;
  title: string;
  category: string;
  status: string;
  due_at: string | null;
  source: string;
  completed_at: string | null;
}

const create = (overrides: Record<string, unknown> = {}) =>
  callTool('create_task', { title: 'Send transcript', ...overrides }, CTX) as Promise<TaskDto>;

describe('task tools', () => {
  it('create_task applies defaults and list_tasks returns the row', async () => {
    const task = await create();
    expect([task.category, task.status, task.source]).toEqual(['other', 'pending', 'manual']);
    const list = await callTool('list_tasks', {}, CTX) as TaskDto[];
    expect(list.map((item) => item.id)).toEqual([task.id]);
  });

  it('creates and returns a task inside an explicit transaction', async () => {
    const task = await withSqlTransaction(() => create({ title: 'Transactional task' }));
    expect(task).toMatchObject({ title: 'Transactional task', status: 'pending' });
    expect(await sqlRows<{ id: string }>(
      `SELECT id FROM tasks WHERE id = '${task.id}'`,
    )).toEqual([{ id: task.id }]);
  });

  it('list_tasks filters by status, category, and overdue date', async () => {
    await create({ title: 'A', category: 'vaccine', due_at: '2020-01-01T00:00:00.000Z' });
    await create({ title: 'B', category: 'housing', due_at: '2999-01-01T00:00:00.000Z' });
    const completed = await create({ title: 'C', category: 'vaccine' });
    await callTool('complete_task', { id: completed.id }, CTX);

    const vaccines = await callTool('list_tasks', { category: 'vaccine' }, CTX) as TaskDto[];
    expect(vaccines.map((task) => task.title)).toEqual(['A', 'C']);
    const done = await callTool('list_tasks', { status: 'completed' }, CTX) as TaskDto[];
    expect(done.map((task) => task.title)).toEqual(['C']);
    const overdue = await callTool('list_tasks', { due: 'overdue' }, CTX) as TaskDto[];
    expect(overdue.map((task) => task.title)).toEqual(['A']);
  });

  it('filters today using the configured timezone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T04:30:00.000Z'));
    try {
      await updateSettings({ timezone: 'America/Chicago' });
      await create({ title: 'Local today', due_at: '2026-03-09T04:45:00.000Z' });
      await create({ title: 'Local tomorrow', due_at: '2026-03-09T05:30:00.000Z' });
      const today = await callTool('list_tasks', { due: 'today' }, CTX) as TaskDto[];
      expect(today.map((task) => task.title)).toEqual(['Local today']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('patches fields, clears due_at, and normalizes date-only deadlines', async () => {
    const task = await create({ due_at: '2026-09-01' });
    expect(task.due_at).toBe('2026-09-01T23:59:59.999Z');
    const updated = await callTool(
      'update_task',
      { id: task.id, title: 'New', status: 'awaiting_confirmation' },
      CTX,
    ) as TaskDto;
    expect([updated.title, updated.status]).toEqual(['New', 'awaiting_confirmation']);
    const cleared = await callTool('update_task', { id: task.id, due_at: null }, CTX) as TaskDto;
    expect(cleared.due_at).toBeNull();
  });

  it('completes, dismisses, and cancels pending reminders', async () => {
    const task = await create();
    await sqlExec(
      `INSERT INTO notifications (` +
      `id, type, title, body, importance, channels, scheduled_for, status, related_type, related_id, ` +
      `created_at, sent_at) VALUES (` +
      `'n1', 'task_reminder', 'r', 'b', 'normal', '["in_app"]', ` +
      `'2026-01-01T00:00:00.000Z', 'pending', 'task', '${task.id}', ` +
      `'2026-01-01T00:00:00.000Z', NULL)`,
    );
    const completed = await callTool('complete_task', { id: task.id }, CTX) as TaskDto;
    expect(completed.status).toBe('completed');
    expect(completed.completed_at).toBeTruthy();
    const reminders = await sqlRows<{ status: string }>(
      `SELECT status FROM notifications WHERE id = 'n1'`,
    );
    expect(reminders[0]?.status).toBe('cancelled');

    const other = await create({ title: 'D' });
    const dismissed = await callTool('dismiss_task', { id: other.id }, CTX) as TaskDto;
    expect(dismissed.status).toBe('dismissed');
  });

  it('requires delete confirmation and rejects a missing task', async () => {
    const task = await create();
    await expect(callTool('delete_task', { id: task.id }, CTX)).rejects.toThrow();
    await callTool('delete_task', { id: task.id, confirm: true }, CTX);
    expect(await callTool('list_tasks', {}, CTX) as TaskDto[]).toHaveLength(0);
    await expect(callTool('update_task', { id: 'nope', title: 'x' }, CTX))
      .rejects.toThrow(/not found/i);
  });

  it('adapts POST, GET, and missing PATCH through REST', async () => {
    const tasksRoute = await import('../../src/app/api/tasks/route');
    const idRoute = await import('../../src/app/api/tasks/[id]/route');
    const created = await tasksRoute.POST(new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Via REST' }),
    }));
    expect(created.status).toBe(201);
    const { id } = await created.json() as TaskDto;

    const list = await tasksRoute.GET(new NextRequest('http://localhost/api/tasks'));
    expect((await list.json() as TaskDto[]).map((task) => task.id)).toEqual([id]);

    const missing = await idRoute.PATCH(new NextRequest('http://localhost/api/tasks/nope', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'x' }),
    }), { params: Promise.resolve({ id: 'nope' }) });
    expect(missing.status).toBe(404);
  });
});

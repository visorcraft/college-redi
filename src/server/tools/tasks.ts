import { randomUUID } from 'node:crypto';
import {
  createTaskParamsSchema,
  deleteTaskParamsSchema,
  listTaskParamsSchema,
  normalizeDueAt,
  pendingChecklistEntrySchema,
  taskIdParamsSchema,
  updateTaskParamsSchema,
} from '../../lib/schemas/tasks';
import { lit, sqlExec, sqlRows } from '../db/sql';
import { getSettings, updateSettings } from '../settings';
import { NotFoundError } from './errors';
import { defineTool, type Tool } from './registry';

export { NotFoundError } from './errors';

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  due_at: string | null;
  reminder_policy: string | null;
  source: string;
  source_email_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function toDto(row: TaskRow) {
  return {
    ...row,
    reminder_policy: row.reminder_policy ? JSON.parse(row.reminder_policy) as unknown : null,
  };
}

async function getTaskRow(id: string): Promise<TaskRow> {
  const row = (await sqlRows<TaskRow>(`SELECT * FROM tasks WHERE id = ${lit(id)}`))[0];
  if (!row) throw new NotFoundError(`task not found: ${id}`);
  return row;
}

function cancelPendingReminders(taskId: string): Promise<void> {
  return sqlExec(
    `UPDATE notifications SET status = 'cancelled' ` +
    `WHERE type = 'task_reminder' AND related_id = ${lit(taskId)} AND status = 'pending'`,
  );
}

async function listTasks(params: unknown) {
  const parsed = listTaskParamsSchema.parse(params);
  const now = new Date();
  const conditions: string[] = [];
  if (parsed.status) conditions.push(`status = ${lit(parsed.status)}`);
  if (parsed.category) conditions.push(`category = ${lit(parsed.category)}`);
  if (parsed.due === 'overdue') {
    conditions.push(
      `due_at IS NOT NULL AND due_at < ${lit(now)} ` +
      `AND status IN ('pending', 'awaiting_confirmation')`,
    );
  }
  if (parsed.due === 'today') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 86_400_000);
    conditions.push(`due_at IS NOT NULL AND due_at >= ${lit(start)} AND due_at < ${lit(end)}`);
  }
  if (parsed.due === 'next_7_days') {
    conditions.push(
      `due_at IS NOT NULL AND due_at >= ${lit(now)} ` +
      `AND due_at < ${lit(new Date(now.getTime() + 7 * 86_400_000))}`,
    );
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const rows = await sqlRows<TaskRow>(
    `SELECT * FROM tasks${where} ORDER BY due_at ASC NULLS LAST, created_at DESC LIMIT ${parsed.limit}`,
  );
  return rows.map(toDto);
}

async function createTask(params: unknown) {
  const parsed = createTaskParamsSchema.parse(params);
  const now = new Date().toISOString();
  const id = randomUUID();
  await sqlExec(
    `INSERT INTO tasks (` +
    `id, title, description, category, status, due_at, reminder_policy, source, ` +
    `source_email_id, created_at, updated_at, completed_at` +
    `) VALUES (` +
    `${lit(id)}, ${lit(parsed.title)}, ${lit(parsed.description ?? null)}, ${lit(parsed.category)}, ` +
    `'pending', ${lit(parsed.due_at ? normalizeDueAt(parsed.due_at) : null)}, ` +
    `${lit(parsed.reminder_policy ? JSON.stringify(parsed.reminder_policy) : null)}, ` +
    `${lit(parsed.source)}, ${lit(parsed.source_email_id ?? null)}, ${lit(now)}, ${lit(now)}, NULL)`,
  );
  return toDto(await getTaskRow(id));
}

async function updateTask(params: unknown) {
  const parsed = updateTaskParamsSchema.parse(params);
  await getTaskRow(parsed.id);
  const sets = [`updated_at = ${lit(new Date())}`];
  if (parsed.title !== undefined) sets.push(`title = ${lit(parsed.title)}`);
  if (parsed.description !== undefined) sets.push(`description = ${lit(parsed.description ?? null)}`);
  if (parsed.category !== undefined) sets.push(`category = ${lit(parsed.category)}`);
  if (parsed.status !== undefined) sets.push(`status = ${lit(parsed.status)}`);
  if (parsed.due_at !== undefined) {
    sets.push(`due_at = ${lit(parsed.due_at ? normalizeDueAt(parsed.due_at) : null)}`);
  }
  if (parsed.reminder_policy !== undefined) {
    sets.push(
      `reminder_policy = ${lit(parsed.reminder_policy ? JSON.stringify(parsed.reminder_policy) : null)}`,
    );
  }
  await sqlExec(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ${lit(parsed.id)}`);
  return toDto(await getTaskRow(parsed.id));
}

async function setTerminalStatus(params: unknown, status: 'completed' | 'dismissed') {
  const parsed = taskIdParamsSchema.parse(params);
  await getTaskRow(parsed.id);
  const now = new Date().toISOString();
  await sqlExec(
    `UPDATE tasks SET status = ${lit(status)}, updated_at = ${lit(now)}, ` +
    `completed_at = ${status === 'completed' ? lit(now) : 'completed_at'} WHERE id = ${lit(parsed.id)}`,
  );
  await cancelPendingReminders(parsed.id);
  return toDto(await getTaskRow(parsed.id));
}

async function deleteTask(params: unknown) {
  const parsed = deleteTaskParamsSchema.parse(params);
  await getTaskRow(parsed.id);
  await cancelPendingReminders(parsed.id);
  await sqlExec(`DELETE FROM tasks WHERE id = ${lit(parsed.id)}`);
  return { deleted: true, id: parsed.id };
}

export async function materializePendingChecklist(): Promise<{ created: number }> {
  const settings = await getSettings();
  const entries = settings.wizard_state.pending_checklist;
  if (!entries?.length) return { created: 0 };

  let created = 0;
  let changed = false;
  const next: typeof entries = [];
  for (const rawEntry of entries) {
    const result = pendingChecklistEntrySchema.safeParse(rawEntry);
    if (!result.success || result.data.materialized) {
      next.push(rawEntry);
      continue;
    }
    const entry = result.data;
    const duplicate = await sqlRows<{ id: string }>(
      `SELECT id FROM tasks WHERE source = 'wizard' AND title = ${lit(entry.title)} LIMIT 1`,
    );
    if (duplicate.length === 0) {
      await createTask({
        title: entry.title,
        description: entry.description ?? null,
        category: entry.category,
        due_at: entry.due_at ?? null,
        source: 'wizard',
      });
      created += 1;
    }
    next.push({ ...entry, due_at: entry.due_at ?? null, materialized: true });
    changed = true;
  }
  if (changed) {
    await updateSettings({
      wizard_state: {
        ...settings.wizard_state,
        pending_checklist: next,
      },
    });
  }
  return { created };
}

const list_tasks = defineTool({
  name: 'list_tasks',
  description: 'List tasks, optionally filtered by status, category, or due window.',
  sideEffect: 'read',
  paramsSchema: listTaskParamsSchema,
  handler: (_ctx, params) => listTasks(params),
});

const create_task = defineTool({
  name: 'create_task',
  description: 'Create an administrative task.',
  sideEffect: 'write',
  paramsSchema: createTaskParamsSchema,
  handler: (_ctx, params) => createTask(params),
});

const update_task = defineTool({
  name: 'update_task',
  description: 'Update a task.',
  sideEffect: 'write',
  paramsSchema: updateTaskParamsSchema,
  handler: (_ctx, params) => updateTask(params),
});

const complete_task = defineTool({
  name: 'complete_task',
  description: 'Complete a task and cancel pending reminders.',
  sideEffect: 'write',
  paramsSchema: taskIdParamsSchema,
  handler: (_ctx, params) => setTerminalStatus(params, 'completed'),
});

const dismiss_task = defineTool({
  name: 'dismiss_task',
  description: 'Dismiss a task and cancel pending reminders.',
  sideEffect: 'write',
  paramsSchema: taskIdParamsSchema,
  handler: (_ctx, params) => setTerminalStatus(params, 'dismissed'),
});

const delete_task = defineTool({
  name: 'delete_task',
  description: 'Permanently delete a task. Requires confirm: true.',
  sideEffect: 'destructive',
  paramsSchema: deleteTaskParamsSchema,
  handler: (_ctx, params) => deleteTask(params),
});

export const taskTools = [
  list_tasks,
  create_task,
  update_task,
  complete_task,
  dismiss_task,
  delete_task,
] as Tool[];

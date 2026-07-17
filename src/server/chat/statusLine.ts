import { callTool } from '../tools/call';

const CONTEXT = { actor: 'system' };

function records(value: unknown, key: string): Record<string, unknown>[] {
  const candidate = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>)[key]
      : [];
  return Array.isArray(candidate)
    ? candidate.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object')
    : [];
}

export async function buildDashboardLine(): Promise<{
  line: string;
  unreadCount: number;
}> {
  let aiOk = true;
  let dueToday = 0;
  let unreadCount = 0;

  try {
    const result = await callTool('get_system_status', {}, CONTEXT);
    const status = result && typeof result === 'object'
      ? result as Record<string, unknown>
      : {};
    const ai = status.ai && typeof status.ai === 'object'
      ? status.ai as Record<string, unknown>
      : {};
    if (ai.ok === false || ai.configured === false) aiOk = false;
  } catch {
    // Status failure should not break the dashboard.
  }

  try {
    const result = await callTool(
      'list_tasks',
      { status: 'pending' },
      CONTEXT,
    );
    const today = new Date().toISOString().slice(0, 10);
    dueToday = records(result, 'tasks').filter((task) =>
      typeof task.due_at === 'string'
      && task.due_at.slice(0, 10) <= today).length;
  } catch {
    // Task failure should not break the dashboard.
  }

  try {
    const result = await callTool(
      'list_notifications',
      { unread_only: true },
      CONTEXT,
    );
    unreadCount = records(result, 'notifications').length;
  } catch {
    // Notification failure should not break the dashboard.
  }

  if (!aiOk) {
    return {
      line: 'My AI brain is offline — chat is sleepy, but everything else keeps working.',
      unreadCount,
    };
  }
  if (dueToday > 0) {
    return {
      line: `You have ${dueToday} thing${dueToday === 1 ? '' : 's'} due today — you've got this ⛅`,
      unreadCount,
    };
  }
  if (unreadCount > 0) {
    return {
      line: `${unreadCount} unread update${unreadCount === 1 ? '' : 's'} waiting in your notifications ☁️`,
      unreadCount,
    };
  }
  return { line: 'All clear — nothing due today ☀️', unreadCount };
}

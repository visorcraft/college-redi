import { lit, sqlRows, withSqlTransaction } from '../db/sql';
import { DEFAULT_REMINDER_POLICY, reminderPolicySchema, type ReminderPolicy } from '../../lib/schemas/tasks';
import {
  dispatchDueNotifications, enqueueNotification, loadEngineSettings,
  type DispatchSummary, type EngineSettings,
} from './engine';
import {
  collectCollegeEmailDigestItems,
  markCollegeEmailDigestItemsIncluded,
  renderCollegeEmailDigestSection,
} from '../email/digest';
import { localDateKey, localDayOrdinal, zonedDayBounds } from '../time';

const DAY_MS = 86_400_000;
const ITEM_LEASE_MS = 60_000;
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function isoWeekKey(d: Date, timeZone = 'UTC'): string {
  const date = startOfUtcDay(new Date(`${localDateKey(d, timeZone)}T00:00:00.000Z`));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7) + 3);
  return `${date.getUTCFullYear()}-W${String(1 + Math.round((date.getTime() - first.getTime()) / (7 * DAY_MS))).padStart(2, '0')}`;
}

interface TaskRow {
  id: string; title: string; status: string; due_at: string | null;
  reminder_policy: string | null; updated_at: string;
}

function taskPolicy(task: TaskRow, settings: EngineSettings): ReminderPolicy {
  if (task.reminder_policy) {
    const parsed = reminderPolicySchema.safeParse(JSON.parse(task.reminder_policy));
    if (parsed.success) return parsed.data;
  }
  return settings.notification_prefs?.default_reminder_policy ?? DEFAULT_REMINDER_POLICY;
}

const remindedToday = async (taskId: string, now: Date, timeZone: string) =>
  Number((await sqlRows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notifications WHERE type = 'task_reminder' AND related_id = ${lit(taskId)} AND created_at >= ${lit(zonedDayBounds(now, timeZone).start)}`,
  ))[0]?.n ?? 0) > 0;

async function runEnqueueLease(
  leaseName: string,
  signal: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<boolean>,
): Promise<boolean> {
  signal?.throwIfAborted();
  const { withLease } = await import('../scheduler');
  const outcome = await withLease(leaseName, ITEM_LEASE_MS, async (itemSignal) => {
    signal?.throwIfAborted();
    return fn(itemSignal);
  });
  if (!outcome.skipped && 'error' in outcome) throw new Error(outcome.error);
  return !outcome.skipped && 'result' in outcome && outcome.result;
}

export async function enqueueDueTaskReminders(
  now = new Date(),
  signal?: AbortSignal,
): Promise<{ enqueued: number }> {
  const settings = await loadEngineSettings();
  const timeZone = settings.timezone ?? 'UTC';
  const date = localDateKey(now, timeZone);
  const tasks = await sqlRows<TaskRow>(`SELECT * FROM tasks WHERE status IN ('pending', 'awaiting_confirmation')`);
  let enqueued = 0;
  for (const task of tasks) {
    signal?.throwIfAborted();
    const policy = taskPolicy(task, settings);
    if (task.status === 'pending' && task.due_at) {
      const daysUntilDue = Math.round(
        localDayOrdinal(new Date(task.due_at), timeZone) - localDayOrdinal(now, timeZone),
      );
      const hit = policy.offsets_days.includes(daysUntilDue)
        || (daysUntilDue < 0 && -daysUntilDue <= policy.overdue_daily_days);
      if (hit && await runEnqueueLease(
        `task_reminder:${task.id}:${date}`,
        signal,
        async (itemSignal) => {
          itemSignal.throwIfAborted();
          if (await remindedToday(task.id, now, timeZone)) return false;
          const when = daysUntilDue > 0 ? `due in ${daysUntilDue} day(s)`
            : daysUntilDue === 0 ? 'due today'
              : `overdue by ${-daysUntilDue} day(s)`;
          await enqueueNotification({
            type: 'task_reminder',
            title: `Task ${when}: ${task.title}`,
            body: `"${task.title}" is ${when}. Open Tasks to complete or dismiss it.`,
            importance: 'normal',
            scheduledFor: now,
            relatedType: 'task',
            relatedId: task.id,
          });
          return true;
        },
      )) enqueued += 1;
    }
    if (task.status === 'awaiting_confirmation') {
      const sinceMs = now.getTime() - new Date(task.updated_at).getTime();
      if (sinceMs >= policy.awaiting_renag_days * DAY_MS) {
        if (await runEnqueueLease(
          `task_reminder:${task.id}:${date}`,
          signal,
          async (itemSignal) => {
            itemSignal.throwIfAborted();
            const current = await sqlRows<{ n: number }>(
              `SELECT COUNT(*) AS n FROM notifications WHERE type = 'task_reminder' AND related_id = ${lit(task.id)} AND created_at >= ${lit(new Date(now.getTime() - policy.awaiting_renag_days * DAY_MS))}`,
            );
            if (Number(current[0]?.n ?? 0) > 0) return false;
            await enqueueNotification({
              type: 'task_reminder',
              title: `Still waiting: ${task.title}`,
              body: `You marked "${task.title}" as sent ${Math.floor(sinceMs / DAY_MS)} day(s) ago. Confirm it arrived, or give them a nudge.`,
              importance: 'low',
              scheduledFor: now,
              relatedType: 'task',
              relatedId: task.id,
            });
            return true;
          },
        )) enqueued += 1;
      }
    }
  }
  return { enqueued };
}

export async function runNotificationDispatchJob(
  now = new Date(),
  signal?: AbortSignal,
): Promise<DispatchSummary & { reminders_enqueued: number }> {
  const { enqueued } = await enqueueDueTaskReminders(now, signal);
  signal?.throwIfAborted();
  return { ...(await dispatchDueNotifications(now, signal)), reminders_enqueued: enqueued };
}

export async function runDailyDigestJob(
  now = new Date(),
  signal?: AbortSignal,
): Promise<{ sent: boolean; reason?: string }> {
  signal?.throwIfAborted();
  const settings = await loadEngineSettings();
  if (settings.notification_prefs?.digest_enabled === false) {
    return { sent: false, reason: 'digest_disabled' };
  }
  const timeZone = settings.timezone ?? 'UTC';
  const stamp = localDateKey(now, timeZone);
  const digestId = `daily-digest:${stamp}`;
  if ((await sqlRows<{ id: string }>(
    `SELECT id FROM notifications WHERE id = ${lit(digestId)} LIMIT 1`,
  ))[0]) {
    return { sent: false, reason: 'already_sent' };
  }
  const today = zonedDayBounds(now, timeZone);
  const todayStart = today.start;
  const tomorrowStart = today.end;
  const weekEnd = zonedDayBounds(now, timeZone, 7).end;
  const collegeEmails = await collectCollegeEmailDigestItems();
  const open = `status IN ('pending', 'awaiting_confirmation') AND due_at IS NOT NULL`;
  const dueToday = await sqlRows<TaskRow>(
    `SELECT * FROM tasks WHERE ${open} AND due_at >= ${lit(todayStart)} AND due_at < ${lit(tomorrowStart)} ORDER BY due_at ASC`,
  );
  const upcoming = await sqlRows<TaskRow>(
    `SELECT * FROM tasks WHERE ${open} AND due_at >= ${lit(tomorrowStart)} AND due_at < ${lit(weekEnd)} ORDER BY due_at ASC`,
  );
  if (collegeEmails.length === 0 && dueToday.length === 0 && upcoming.length === 0) {
    return { sent: false, reason: 'empty' };
  }
  const lines: string[] = [`Your Redi digest for ${stamp}:`, ''];
  const collegeEmailSection = renderCollegeEmailDigestSection(collegeEmails);
  if (collegeEmailSection) lines.push(collegeEmailSection, '');
  if (dueToday.length > 0) {
    lines.push('Due today:');
    for (const t of dueToday) lines.push(`• ${t.title}`);
    lines.push('');
  }
  if (upcoming.length > 0) {
    lines.push('Coming up this week:');
    for (const t of upcoming) {
      lines.push(`• ${t.title} — due ${localDateKey(new Date(t.due_at!), timeZone)}`);
    }
  }
  return withSqlTransaction(async () => {
    signal?.throwIfAborted();
    await enqueueNotification({
      type: 'digest',
      title: `☁️ Your daily digest — ${stamp}`,
      body: lines.join('\n'),
      importance: 'low',
      channels: ['in_app', 'email'],
      scheduledFor: now,
      relatedType: 'digest',
      relatedId: stamp,
    }, digestId);
    await markCollegeEmailDigestItemsIncluded(
      collegeEmails.map(({ id }) => id),
    );
    return { sent: true };
  });
}

interface TermRow {
  id: string; name: string; registration_opens_at: string | null;
  registration_closes_at: string | null; add_drop_deadline: string | null; tuition_due: string | null;
}

const alreadySent = async (relatedId: string) =>
  Number((await sqlRows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notifications WHERE related_type = 'term' AND related_id = ${lit(relatedId)} AND status != 'cancelled'`,
  ))[0]?.n ?? 0) > 0;

export async function runRegistrationSweepJob(
  now = new Date(),
  signal?: AbortSignal,
): Promise<{ enqueued: number }> {
  const timeZone = (await loadEngineSettings()).timezone ?? 'UTC';
  let enqueued = 0;
  const enqueueTermOnce = async (n: {
    type: string; title: string; body: string; importance: 'normal' | 'urgent'; relatedId: string;
  }) => {
    if (await runEnqueueLease(
      `registration_reminder:${n.relatedId}`,
      signal,
      async (itemSignal) => {
        itemSignal.throwIfAborted();
        if (await alreadySent(n.relatedId)) return false;
        await enqueueNotification({
          type: n.type,
          title: n.title,
          body: n.body,
          importance: n.importance,
          scheduledFor: now,
          relatedType: 'term',
          relatedId: n.relatedId,
        });
        return true;
      },
    )) enqueued += 1;
  };
  for (const term of await sqlRows<TermRow>(`SELECT * FROM terms`)) {
    signal?.throwIfAborted();
    const unregistered = Number((await sqlRows<{ n: number }>(
      `SELECT COUNT(*) AS n FROM planned_courses WHERE term_id = ${lit(term.id)} AND status IN ('planned', 'waitlisted')`,
    ))[0]?.n ?? 0);
    if (term.registration_opens_at && unregistered > 0) {
      const opensMs = new Date(term.registration_opens_at).getTime();
      const untilOpen = opensMs - now.getTime();
      for (const m of [
        { tag: '1h', label: '1 hour', ms: 3_600_000, importance: 'urgent' as const },
        { tag: '1d', label: '1 day', ms: DAY_MS, importance: 'normal' as const },
        { tag: '7d', label: '7 days', ms: 7 * DAY_MS, importance: 'normal' as const },
      ]) {
        if (untilOpen > 0 && untilOpen <= m.ms) {
          await enqueueTermOnce({
            type: 'registration_window',
            title: `Registration for ${term.name} opens in ${m.label}`,
            body: `You have ${unregistered} planned course(s) for ${term.name} that are not registered yet. Registration opens ${term.registration_opens_at}.`,
            importance: m.importance,
            relatedId: `${term.id}:registration_opens:${m.tag}`,
          });
          break;
        }
      }
      const closesMs = term.registration_closes_at ? new Date(term.registration_closes_at).getTime() : null;
      if (closesMs !== null && opensMs <= now.getTime() && now.getTime() <= closesMs) {
        await enqueueTermOnce({
          type: 'registration_window',
          title: `You still have ${unregistered} unregistered planned course(s) for ${term.name}`,
          body: `Registration for ${term.name} is open until ${term.registration_closes_at}. Finish registering your planned courses.`,
          importance: 'normal',
          relatedId: `${term.id}:open_weekly:${isoWeekKey(now, timeZone)}`,
        });
      }
    }
    for (const [field, kind, label] of [
      ['add_drop_deadline', 'add_drop', 'Add/drop deadline'],
      ['tuition_due', 'tuition', 'Tuition payment due'],
    ] as const) {
      const at = term[field];
      if (!at) continue;
      const until = new Date(at).getTime() - now.getTime();
      for (const m of [{ tag: '1d', ms: DAY_MS }, { tag: '3d', ms: 3 * DAY_MS }]) {
        if (until > 0 && until <= m.ms) {
          await enqueueTermOnce({
            type: 'deadline_reminder',
            title: `${label} for ${term.name} in ${m.tag === '3d' ? '3 days' : '1 day'}`,
            body: `${label} for ${term.name}: ${at}.`,
            importance: 'normal',
            relatedId: `${term.id}:${kind}:${m.tag}`,
          });
          break;
        }
      }
    }
  }
  return { enqueued };
}

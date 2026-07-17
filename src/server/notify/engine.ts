import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSettings } from '../settings';
import { lit, sqlExec, sqlRows } from '../db/sql';
import { enqueueNotificationSchema, notificationChannelSchema } from '../../lib/schemas/notifications';
import type { ReminderPolicy } from '../../lib/schemas/tasks';

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type Importance = z.infer<typeof enqueueNotificationSchema>['importance'];
export type EnqueueNotificationInput = z.infer<typeof enqueueNotificationSchema>;

export interface EngineSettings {
  timezone?: string;
  quiet_hours?: { start: string; end: string } | null;
  notification_prefs?: {
    urgent?: NotificationChannel[];
    normal?: NotificationChannel[];
    low?: NotificationChannel[];
    digest_enabled?: boolean;
    digest_time?: string;
    default_reminder_policy?: ReminderPolicy;
  } | null;
  smtp?: {
    enabled?: boolean; host?: string; port?: number; security?: string;
    username?: string; from_address?: string; personal_email?: string;
  } | null;
  twilio?: { enabled?: boolean; account_sid?: string; from_number?: string; to_number?: string } | null;
}

export const loadEngineSettings = async (): Promise<EngineSettings> => (await getSettings()) as unknown as EngineSettings;

const DEFAULT_CHANNEL_MAP: Record<Importance, NotificationChannel[]> = {
  urgent: ['in_app', 'email', 'sms'],
  normal: ['in_app', 'email'],
  low: ['in_app'],
};
const DEFAULT_QUIET_HOURS = { start: '22:00', end: '08:00' };

export const smtpConfigured = (s: EngineSettings) =>
  Boolean(s.smtp?.enabled && s.smtp.host && s.smtp.personal_email);
export const twilioConfigured = (s: EngineSettings) =>
  Boolean(s.twilio?.enabled && s.twilio.account_sid && s.twilio.to_number);

export function resolveChannels(
  importance: Importance,
  settings: EngineSettings,
  requested?: NotificationChannel[],
): NotificationChannel[] {
  const base = requested ?? settings.notification_prefs?.[importance] ?? DEFAULT_CHANNEL_MAP[importance];
  const out = new Set<NotificationChannel>();
  for (const ch of base) {
    if (ch === 'in_app') out.add('in_app');
    if (ch === 'email' && smtpConfigured(settings)) out.add('email');
    if (ch === 'sms' && twilioConfigured(settings)) out.add('sms');
  }
  if (out.size === 0) out.add('in_app');
  return (['in_app', 'email', 'sms'] as const).filter((c) => out.has(c));
}

function minutesOfDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return (num('hour') % 24) * 60 + num('minute');
}

function parseHHMM(v: string): number {
  const [h = '0', m = '0'] = v.split(':');
  return (((Number(h) % 24) + 24) % 24) * 60 + Number(m);
}

export function isInQuietHours(at: Date, quiet: { start: string; end: string }, timeZone = 'UTC'): boolean {
  const start = parseHHMM(quiet.start);
  const end = parseHHMM(quiet.end);
  if (start === end) return false;
  const cur = minutesOfDay(at, timeZone);
  return start > end ? cur >= start || cur < end : cur >= start && cur < end;
}

export function quietHoursEnd(at: Date, quiet: { start: string; end: string }, timeZone = 'UTC'): Date {
  const end = parseHHMM(quiet.end);
  const probe = new Date(at.getTime());
  probe.setUTCSeconds(0, 0);
  for (let i = 0; i <= 26 * 60; i += 1) {
    if (probe.getTime() >= at.getTime() && minutesOfDay(probe, timeZone) === end) return probe;
    probe.setTime(probe.getTime() + 60_000);
  }
  return new Date(at.getTime() + 8 * 3_600_000);
}

export function applyQuietHours(at: Date, importance: Importance, settings: EngineSettings): Date {
  if (importance === 'urgent') return at;
  const quiet = settings.quiet_hours ?? DEFAULT_QUIET_HOURS;
  const tz = settings.timezone ?? 'UTC';
  return isInQuietHours(at, quiet, tz) ? quietHoursEnd(at, quiet, tz) : at;
}

export async function enqueueNotification(input: EnqueueNotificationInput): Promise<string> {
  const parsed = enqueueNotificationSchema.parse(input);
  const settings = await loadEngineSettings();
  const channels = resolveChannels(parsed.importance, settings, parsed.channels);
  const scheduledFor = applyQuietHours(parsed.scheduledFor, parsed.importance, settings);
  const id = randomUUID();
  await sqlExec(`INSERT INTO notifications (id, type, title, body, importance, channels, scheduled_for, status, related_type, related_id, created_at, sent_at) VALUES (${lit(id)}, ${lit(parsed.type)}, ${lit(parsed.title)}, ${lit(parsed.body)}, ${lit(parsed.importance)}, ${lit(JSON.stringify(channels))}, ${lit(scheduledFor)}, 'pending', ${lit(parsed.relatedType ?? null)}, ${lit(parsed.relatedId ?? null)}, ${lit(new Date())}, NULL)`);
  return id;
}

interface NotificationRow { id: string; title: string; body: string; importance: Importance; channels: string }
interface HistoryRow { status: 'sent' | 'failed'; attempt: number; sent_at: string }

export interface DispatchSummary { due: number; sent: number; failed: number; awaiting_retry: number; held: number }

export const RETRY_BACKOFF_MS = [60_000, 15 * 60_000, 3_600_000] as const;
const MAX_FAILED_ATTEMPTS = 1 + RETRY_BACKOFF_MS.length;

type ChannelState = 'sent' | 'exhausted' | 'awaiting_retry' | 'ready';

async function channelState(
  notificationId: string,
  channel: string,
  now: Date,
): Promise<{ state: ChannelState; attempts: number }> {
  const rows = await sqlRows<HistoryRow>(
    `SELECT status, attempt, sent_at FROM notification_history WHERE notification_id = ${lit(notificationId)} AND channel = ${lit(channel)} ORDER BY attempt ASC`,
  );
  if (rows.some((r) => r.status === 'sent')) return { state: 'sent', attempts: rows.length };
  const failed = rows.filter((r) => r.status === 'failed');
  if (failed.length >= MAX_FAILED_ATTEMPTS) return { state: 'exhausted', attempts: rows.length };
  if (failed.length === 0) return { state: 'ready', attempts: 0 };
  const lastFailedAt = new Date(failed[failed.length - 1]!.sent_at).getTime();
  const wait = RETRY_BACKOFF_MS[Math.min(failed.length - 1, RETRY_BACKOFF_MS.length - 1)];
  return now.getTime() - lastFailedAt >= wait
    ? { state: 'ready', attempts: rows.length }
    : { state: 'awaiting_retry', attempts: rows.length };
}

const destinationFor = (channel: NotificationChannel, s: EngineSettings) =>
  channel === 'in_app' ? 'in_app'
    : channel === 'email' ? s.smtp?.personal_email ?? ''
      : s.twilio?.to_number ?? '';

async function deliver(
  channel: NotificationChannel,
  n: NotificationRow,
  settings: EngineSettings,
): Promise<Record<string, unknown>> {
  if (channel === 'in_app') return { delivered: 'in_app' };
  if (channel === 'email') {
    const to = settings.smtp?.personal_email;
    if (!to) throw new Error('smtp personal_email not configured');
    const { sendSmtpMail } = await import('./smtp');
    return sendSmtpMail({ to, subject: n.title, text: n.body });
  }
  const to = settings.twilio?.to_number;
  if (!to) throw new Error('twilio to_number not configured');
  const { sendTwilioSms } = await import('./twilio');
  return sendTwilioSms({ to, body: `${n.title}\n${n.body}`.slice(0, 1500) });
}

export async function dispatchDueNotifications(now = new Date()): Promise<DispatchSummary> {
  const settings = await loadEngineSettings();
  const quiet = settings.quiet_hours ?? DEFAULT_QUIET_HOURS;
  const tz = settings.timezone ?? 'UTC';
  const due = await sqlRows<NotificationRow & { scheduled_for: string }>(
    `SELECT * FROM notifications WHERE status = 'pending' AND scheduled_for <= ${lit(now)} ORDER BY scheduled_for ASC LIMIT 200`,
  );
  const summary: DispatchSummary = { due: due.length, sent: 0, failed: 0, awaiting_retry: 0, held: 0 };
  for (const n of due) {
    if (n.importance !== 'urgent' && isInQuietHours(now, quiet, tz)) {
      await sqlExec(`UPDATE notifications SET scheduled_for = ${lit(quietHoursEnd(now, quiet, tz))} WHERE id = ${lit(n.id)}`);
      summary.held += 1;
      continue;
    }
    const channels = JSON.parse(n.channels) as NotificationChannel[];
    for (const channel of channels) {
      const { state, attempts } = await channelState(n.id, channel, now);
      if (state !== 'ready') continue;
      const insert = (status: 'sent' | 'failed', provider: Record<string, unknown>) =>
        sqlExec(`INSERT INTO notification_history (id, notification_id, channel, destination, status, provider_response, attempt, sent_at) VALUES (${lit(randomUUID())}, ${lit(n.id)}, ${lit(channel)}, ${lit(destinationFor(channel, settings))}, ${lit(status)}, ${lit(JSON.stringify(provider))}, ${attempts + 1}, ${lit(now)})`);
      try {
        await insert('sent', await deliver(channel, n, settings));
      } catch (err) {
        await insert('failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    const states = await Promise.all(channels.map((c) => channelState(n.id, c, now)));
    if (states.every((s) => s.state === 'sent')) {
      await sqlExec(`UPDATE notifications SET status = 'sent', sent_at = ${lit(now)} WHERE id = ${lit(n.id)}`);
      summary.sent += 1;
    } else if (states.every((s) => s.state === 'sent' || s.state === 'exhausted')) {
      await sqlExec(`UPDATE notifications SET status = 'failed' WHERE id = ${lit(n.id)}`);
      summary.failed += 1;
    } else {
      summary.awaiting_retry += 1;
    }
  }
  return summary;
}

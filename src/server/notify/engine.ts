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
  const probe = new Date(at.getTime());
  probe.setUTCSeconds(0, 0);
  if (probe < at) probe.setTime(probe.getTime() + 60_000);
  for (let i = 0; i <= 26 * 60; i += 1) {
    if (!isInQuietHours(probe, quiet, timeZone)) return probe;
    probe.setTime(probe.getTime() + 60_000);
  }
  return probe;
}

export function applyQuietHours(at: Date, importance: Importance, settings: EngineSettings): Date {
  if (importance === 'urgent') return at;
  const quiet = settings.quiet_hours ?? DEFAULT_QUIET_HOURS;
  const tz = settings.timezone ?? 'UTC';
  return isInQuietHours(at, quiet, tz) ? quietHoursEnd(at, quiet, tz) : at;
}

export async function enqueueNotification(
  input: EnqueueNotificationInput,
  id: string = randomUUID(),
): Promise<string> {
  const parsed = enqueueNotificationSchema.parse(input);
  const settings = await loadEngineSettings();
  const channels = resolveChannels(parsed.importance, settings, parsed.channels);
  const scheduledFor = applyQuietHours(parsed.scheduledFor, parsed.importance, settings);
  try {
    await sqlExec(`INSERT INTO notifications (id, type, title, body, importance, channels, scheduled_for, status, related_type, related_id, created_at, sent_at) VALUES (${lit(id)}, ${lit(parsed.type)}, ${lit(parsed.title)}, ${lit(parsed.body)}, ${lit(parsed.importance)}, ${lit(JSON.stringify(channels))}, ${lit(scheduledFor)}, 'pending', ${lit(parsed.relatedType ?? null)}, ${lit(parsed.relatedId ?? null)}, ${lit(new Date())}, NULL)`);
  } catch (error) {
    const existing = await sqlRows<{ id: string }>(
      `SELECT id FROM notifications WHERE id = ${lit(id)} LIMIT 1`,
    );
    if (!existing[0]) throw error;
  }
  return id;
}

interface NotificationRow { id: string; title: string; body: string; importance: Importance; channels: string }
interface HistoryRow {
  id: string;
  status: 'sent' | 'failed';
  provider_response: string | null;
  attempt: number;
  sent_at: string;
}

export interface DispatchSummary { due: number; sent: number; failed: number; awaiting_retry: number; held: number }

export const RETRY_BACKOFF_MS = [60_000, 15 * 60_000, 3_600_000] as const;
const MAX_FAILED_ATTEMPTS = 1 + RETRY_BACKOFF_MS.length;
const CHANNEL_CLAIM_MS = 10 * 60_000;
const DELIVERY_RESERVED = '{"delivery":"reserved"}';
const DELIVERY_IN_FLIGHT = '{"delivery":"in_flight"}';
const DELIVERY_UNKNOWN = '{"delivery":"unknown"}';

type ChannelState = 'sent' | 'exhausted' | 'unknown' | 'awaiting_retry' | 'ready';
type DeliveryMarker = 'reserved' | 'in_flight' | 'unknown';

function deliveryMarker(response: string | null): DeliveryMarker | null {
  try {
    const marker = JSON.parse(response ?? '{}').delivery;
    return marker === 'reserved' || marker === 'in_flight' || marker === 'unknown'
      ? marker
      : null;
  } catch {
    return null;
  }
}

async function channelState(
  notificationId: string,
  channel: string,
  now: Date,
): Promise<{ state: ChannelState; attempts: number; reservationId?: string }> {
  const rows = await sqlRows<HistoryRow>(
    `SELECT id, status, provider_response, attempt, sent_at FROM notification_history WHERE notification_id = ${lit(notificationId)} AND channel = ${lit(channel)} ORDER BY attempt ASC, sent_at ASC, id ASC`,
  );
  const attempts = rows.filter((r) => deliveryMarker(r.provider_response) !== 'reserved').length;
  if (rows.some((r) => r.status === 'sent')) return { state: 'sent', attempts };
  const latest = rows.at(-1);
  const marker = deliveryMarker(latest?.provider_response ?? null);
  if (marker === 'reserved') {
    return { state: 'ready', attempts, reservationId: latest!.id };
  }
  if (marker === 'unknown') {
    return { state: 'unknown', attempts };
  }
  if (marker === 'in_flight') {
    return now.getTime() - new Date(latest!.sent_at).getTime() >= CHANNEL_CLAIM_MS
      ? { state: 'unknown', attempts }
      : { state: 'awaiting_retry', attempts };
  }
  const failed = rows.filter((r) =>
    r.status === 'failed' && deliveryMarker(r.provider_response) !== 'reserved');
  if (failed.length >= MAX_FAILED_ATTEMPTS) return { state: 'exhausted', attempts };
  if (failed.length === 0) return { state: 'ready', attempts: 0 };
  const lastFailedAt = new Date(failed[failed.length - 1]!.sent_at).getTime();
  const wait = RETRY_BACKOFF_MS[Math.min(failed.length - 1, RETRY_BACKOFF_MS.length - 1)];
  return now.getTime() - lastFailedAt >= wait
    ? { state: 'ready', attempts }
    : { state: 'awaiting_retry', attempts };
}

const destinationFor = (channel: NotificationChannel, s: EngineSettings) =>
  channel === 'in_app' ? 'in_app'
    : channel === 'email' ? s.smtp?.personal_email ?? ''
      : s.twilio?.to_number ?? '';

function definitelyNotDelivered(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const detail = error as { code?: unknown; responseCode?: unknown; status?: unknown };
  const responseCode = Number(detail.responseCode);
  const status = Number(detail.status);
  return (Number.isInteger(responseCode) && responseCode >= 400)
    || (Number.isInteger(status) && status >= 400 && status < 500)
    || [
      'EAUTH', 'EENVELOPE', 'EMESSAGE', 'ECONNECTION', 'ECONNREFUSED',
      'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN',
    ].includes(String(detail.code ?? ''));
}

async function notificationStatus(id: string): Promise<string | null> {
  return (await sqlRows<{ status: string }>(
    `SELECT status FROM notifications WHERE id = ${lit(id)} LIMIT 1`,
  ))[0]?.status ?? null;
}

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

export async function dispatchDueNotifications(
  now = new Date(),
  signal?: AbortSignal,
): Promise<DispatchSummary> {
  const settings = await loadEngineSettings();
  const quiet = settings.quiet_hours ?? DEFAULT_QUIET_HOURS;
  const tz = settings.timezone ?? 'UTC';
  const due = await sqlRows<NotificationRow & { scheduled_for: string }>(
    `SELECT * FROM notifications WHERE status = 'pending' AND scheduled_for <= ${lit(now)} ORDER BY scheduled_for ASC LIMIT 200`,
  );
  const summary: DispatchSummary = { due: due.length, sent: 0, failed: 0, awaiting_retry: 0, held: 0 };
  for (const n of due) {
    signal?.throwIfAborted();
    if (n.importance !== 'urgent' && isInQuietHours(now, quiet, tz)) {
      await sqlExec(`UPDATE notifications SET scheduled_for = ${lit(quietHoursEnd(now, quiet, tz))} WHERE id = ${lit(n.id)} AND status = 'pending'`);
      summary.held += 1;
      continue;
    }
    const channels = JSON.parse(n.channels) as NotificationChannel[];
    for (const channel of channels) {
      signal?.throwIfAborted();
      const { state } = await channelState(n.id, channel, now);
      if (state !== 'ready') continue;
      const scheduler = await import('../scheduler');
      const claimName = `notification:${n.id}:${channel}`;
      const owner = await scheduler.acquireJobLeaseToken(
        claimName,
        CHANNEL_CLAIM_MS,
        new Date(),
      );
      if (!owner) continue;
      let channelLeaseLost = false;
      const stopHeartbeat = scheduler.keepJobLeaseAlive(
        claimName,
        owner,
        CHANNEL_CLAIM_MS,
        () => {
          channelLeaseLost = true;
        },
      );
      try {
        const claimed = await channelState(n.id, channel, now);
        if (claimed.state === 'ready' && await notificationStatus(n.id) === 'pending') {
          signal?.throwIfAborted();
          if (channelLeaseLost) throw new Error(`notification channel lease lost: ${claimName}`);
          const historyId = claimed.reservationId ?? randomUUID();
          const attempt = claimed.attempts + 1;
          if (!claimed.reservationId) {
            await sqlExec(`INSERT INTO notification_history (id, notification_id, channel, destination, status, provider_response, attempt, sent_at) VALUES (${lit(historyId)}, ${lit(n.id)}, ${lit(channel)}, ${lit(destinationFor(channel, settings))}, 'failed', ${lit(DELIVERY_RESERVED)}, ${attempt}, ${lit(new Date())})`);
          }
          await sqlExec(
            `UPDATE notification_history SET provider_response = ${lit(DELIVERY_IN_FLIGHT)}, ` +
            `attempt = ${attempt}, sent_at = ${lit(new Date())} ` +
            `WHERE id = ${lit(historyId)}`,
          );
          if (await notificationStatus(n.id) !== 'pending') {
            await sqlExec(
              `UPDATE notification_history SET provider_response = '{"delivery":"cancelled"}' ` +
              `WHERE id = ${lit(historyId)}`,
            );
            continue;
          }
          let status: 'sent' | 'failed' = 'sent';
          let provider: Record<string, unknown>;
          try {
            provider = await deliver(channel, n, settings);
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            provider = definitelyNotDelivered(err)
              ? { error }
              : { delivery: 'unknown', error };
            status = 'failed';
          }
          await sqlExec(
            `UPDATE notification_history SET status = ${lit(status)}, ` +
            `provider_response = ${lit(JSON.stringify(provider))} WHERE id = ${lit(historyId)}`,
          );
        }
      } finally {
        stopHeartbeat();
        await scheduler.releaseJobLease(claimName, 'ok', new Date(), owner);
      }
      if (channelLeaseLost) throw new Error(`notification channel lease lost: ${claimName}`);
      signal?.throwIfAborted();
    }
    if (await notificationStatus(n.id) !== 'pending') continue;
    const states = await Promise.all(channels.map((c) => channelState(n.id, c, now)));
    for (let index = 0; index < channels.length; index += 1) {
      if (states[index]?.state === 'unknown') {
        const scheduler = await import('../scheduler');
        const claimName = `notification:${n.id}:${channels[index]!}`;
        const owner = await scheduler.acquireJobLeaseToken(claimName, CHANNEL_CLAIM_MS, new Date());
        if (!owner) {
          states[index] = { ...states[index]!, state: 'awaiting_retry' };
          continue;
        }
        try {
          await sqlExec(
            `UPDATE notification_history SET provider_response = ${lit(DELIVERY_UNKNOWN)} ` +
            `WHERE notification_id = ${lit(n.id)} AND channel = ${lit(channels[index]!)} ` +
            `AND provider_response = ${lit(DELIVERY_IN_FLIGHT)}`,
          );
        } finally {
          await scheduler.releaseJobLease(claimName, 'ok', new Date(), owner);
        }
      }
    }
    if (states.every((s) => s.state === 'sent')) {
      await sqlExec(`UPDATE notifications SET status = 'sent', sent_at = ${lit(now)} WHERE id = ${lit(n.id)} AND status = 'pending'`);
      if (await notificationStatus(n.id) === 'sent') summary.sent += 1;
    } else if (states.every((s) =>
      s.state === 'sent' || s.state === 'exhausted' || s.state === 'unknown')) {
      await sqlExec(`UPDATE notifications SET status = 'failed' WHERE id = ${lit(n.id)} AND status = 'pending'`);
      if (await notificationStatus(n.id) === 'failed') summary.failed += 1;
    } else {
      summary.awaiting_retry += 1;
    }
  }
  return summary;
}

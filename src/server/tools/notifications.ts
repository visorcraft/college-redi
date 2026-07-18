import { z } from 'zod';
import {
  getNotificationHistoryParamsSchema,
  listNotificationsParamsSchema,
  markNotificationReadParamsSchema,
  scheduleNotificationParamsSchema,
} from '../../lib/schemas/notifications';
import { lit, sqlExec, sqlRows } from '../db/sql';
import {
  enqueueNotification,
  smtpConfigured,
  twilioConfigured,
} from '../notify/engine';
import { getSecret } from '../secrets';
import { getSettings } from '../settings';
import { NotFoundError, ToolError } from './errors';
import { defineTool, type Tool } from './registry';

const IN_APP = `channels LIKE '%"in_app"%'`;

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  importance: string;
  channels: string;
  scheduled_for: string;
  status: string;
  related_type: string | null;
  related_id: string | null;
  created_at: string;
  sent_at: string | null;
  read_at: string | null;
}

const toDto = (row: NotificationRow) => ({
  ...row,
  channels: JSON.parse(row.channels) as string[],
  read: row.read_at !== null,
});

async function listNotifications(raw: unknown) {
  const params = listNotificationsParamsSchema.parse(raw);
  const rows = await sqlRows<NotificationRow>(
    `SELECT * FROM notifications WHERE ${IN_APP}` +
    `${params.unread_only ? ' AND read_at IS NULL' : ''} ` +
    `ORDER BY created_at DESC LIMIT ${params.limit}`,
  );
  const unread = await sqlRows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notifications WHERE ${IN_APP} AND read_at IS NULL`,
  );
  return {
    notifications: rows.map(toDto),
    unread_count: Number(unread[0]?.n ?? 0),
  };
}

async function markRead(raw: unknown) {
  const params = markNotificationReadParamsSchema.parse(raw);
  const exists = await sqlRows<{ id: string }>(
    `SELECT id FROM notifications WHERE id = ${lit(params.id)} AND ${IN_APP}`,
  );
  if (!exists[0]) throw new NotFoundError(`notification not found: ${params.id}`);
  await sqlExec(
    `UPDATE notifications SET read_at = ${lit(new Date())} ` +
    `WHERE id = ${lit(params.id)} AND read_at IS NULL`,
  );
  return { ok: true, id: params.id };
}

async function markAllRead() {
  const unread = await sqlRows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notifications WHERE ${IN_APP} AND read_at IS NULL`,
  );
  await sqlExec(
    `UPDATE notifications SET read_at = ${lit(new Date())} ` +
    `WHERE ${IN_APP} AND read_at IS NULL`,
  );
  return { marked: Number(unread[0]?.n ?? 0) };
}

function maskDestination(destination: string): string {
  if (destination === 'in_app' || destination === '') return destination || 'unknown';
  if (destination.includes('@')) {
    const [user = '', domain = ''] = destination.split('@');
    return `${user.slice(0, 2)}***@${domain}`;
  }
  return `***${destination.slice(-4)}`;
}

async function getHistory(raw: unknown) {
  const params = getNotificationHistoryParamsSchema.parse(raw);
  const rows = await sqlRows<Record<string, unknown>>(
    `SELECT h.id, h.notification_id, h.channel, h.destination, h.status, ` +
    `h.provider_response, h.attempt, h.sent_at, n.title AS notification_title ` +
    `FROM notification_history h LEFT JOIN notifications n ON n.id = h.notification_id` +
    `${params.notification_id
      ? ` WHERE h.notification_id = ${lit(params.notification_id)}`
      : ''} ` +
    `ORDER BY h.sent_at DESC LIMIT ${params.limit}`,
  );
  return rows.map((row) => ({
    ...row,
    destination: maskDestination(String(row.destination ?? '')),
    provider_response: row.provider_response
      ? JSON.parse(String(row.provider_response))
      : null,
  }));
}

async function scheduleNotification(raw: unknown) {
  const params = scheduleNotificationParamsSchema.parse(raw);
  if (params.channels?.includes('email') || params.channels?.includes('sms')) {
    const settings = await getSettings();
    const [smtpPassword, twilioToken] = await Promise.all([
      params.channels.includes('email') ? getSecret('smtp.password') : null,
      params.channels.includes('sms') ? getSecret('twilio.auth_token') : null,
    ]);
    const unavailable = [
      params.channels.includes('email')
        && (!smtpConfigured(settings) || smtpPassword === null)
        ? 'email'
        : null,
      params.channels.includes('sms')
        && (!twilioConfigured(settings) || twilioToken === null)
        ? 'SMS'
        : null,
    ].filter(Boolean);
    if (unavailable.length > 0) {
      throw new ToolError(
        'bad_request',
        `${unavailable.join(' and ')} delivery is not configured. Choose another channel or finish its settings.`,
      );
    }
  }
  const id = await enqueueNotification({
    type: 'reminder',
    title: params.title,
    body: params.body,
    importance: params.importance,
    channels: params.channels,
    scheduledFor: new Date(params.scheduled_for),
    relatedType: params.related_type,
    relatedId: params.related_id,
  });
  return { id };
}

const list_notifications = defineTool({
  name: 'list_notifications',
  description: 'List in-app notifications newest first, with unread count.',
  sideEffect: 'read',
  paramsSchema: listNotificationsParamsSchema,
  handler: (_ctx, params) => listNotifications(params),
});

const mark_notification_read = defineTool({
  name: 'mark_notification_read',
  description: 'Mark one in-app notification as read.',
  sideEffect: 'write',
  paramsSchema: markNotificationReadParamsSchema,
  handler: (_ctx, params) => markRead(params),
});

const mark_all_notifications_read = defineTool({
  name: 'mark_all_notifications_read',
  description: 'Mark every in-app notification as read.',
  sideEffect: 'write',
  paramsSchema: z.object({}),
  handler: () => markAllRead(),
});

const get_notification_history = defineTool({
  name: 'get_notification_history',
  description: 'List sent notification history with masked destinations.',
  sideEffect: 'read',
  paramsSchema: getNotificationHistoryParamsSchema,
  handler: (_ctx, params) => getHistory(params),
});

const schedule_notification = defineTool({
  name: 'schedule_notification',
  description: 'Schedule an ad-hoc reminder.',
  sideEffect: 'write',
  paramsSchema: scheduleNotificationParamsSchema,
  handler: (_ctx, params) => scheduleNotification(params),
});

export const notificationTools = [
  list_notifications,
  mark_notification_read,
  mark_all_notifications_read,
  get_notification_history,
  schedule_notification,
] as Tool[];

import { z } from 'zod';

export const NOTIFICATION_CHANNEL_VALUES = ['in_app', 'email', 'sms'] as const;
export const IMPORTANCE_VALUES = ['low', 'normal', 'urgent'] as const;

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNEL_VALUES);
export const importanceSchema = z.enum(IMPORTANCE_VALUES);

export const enqueueNotificationSchema = z.object({
  type: z.string().min(1).max(60),
  title: z.string().min(1).max(300),
  body: z.string().max(8000),
  importance: importanceSchema,
  channels: z.array(notificationChannelSchema).min(1).optional(),
  scheduledFor: z.date(),
  relatedType: z.string().max(60).optional(),
  relatedId: z.string().max(120).optional(),
});

const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: 'must be an ISO datetime' });

export const scheduleNotificationParamsSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().max(8000),
  scheduled_for: isoDateTime,
  importance: importanceSchema.default('normal'),
  channels: z.array(notificationChannelSchema).min(1).optional(),
  related_type: z.string().max(60).optional(),
  related_id: z.string().max(120).optional(),
});

export const listNotificationsParamsSchema = z.object({
  unread_only: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(50),
});

export const markNotificationReadParamsSchema = z.object({ id: z.string().min(1) });

export const getNotificationHistoryParamsSchema = z.object({
  notification_id: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

import { z } from 'zod';

export const channelSchema = z.enum(['in_app', 'email', 'sms']);

export const QuietHoursSchema = z.object({
  start: z.string().default('22:00'),
  end: z.string().default('08:00'),
});

export const NotificationPrefsSchema = z.object({
  digest_enabled: z.boolean().default(true),
  digest_time: z.string().default('08:00'),
  channels: z.object({
    urgent: z.array(channelSchema).default(['in_app', 'email', 'sms']),
    normal: z.array(channelSchema).default(['in_app', 'email']),
    low: z.array(channelSchema).default(['in_app']),
  }),
});

export const ImapSettingsSchema = z.object({
  host: z.string().default(''),
  port: z.number().int().default(993),
  tls: z.boolean().default(true),
  username: z.string().default(''),
  mailbox: z.string().default('INBOX'),
  poll_interval_minutes: z.number().int().min(1).max(60).default(5),
  enabled: z.boolean().default(false),
  auto_accept_events: z.boolean().default(false),
  last_uid: z.number().int().default(0),
  uidvalidity: z.number().int().nullable().default(null),
  last_poll_at: z.string().nullable().default(null),
  last_error: z.string().nullable().default(null),
});

export const SmtpSettingsSchema = z.object({
  host: z.string().default(''),
  port: z.number().int().default(465),
  security: z.enum(['tls', 'starttls', 'none']).default('tls'),
  username: z.string().default(''),
  from_address: z.string().default(''),
  personal_email: z.string().default(''),
  enabled: z.boolean().default(false),
});

export const TwilioSettingsSchema = z.object({
  account_sid: z.string().default(''),
  from_number: z.string().default(''),
  to_number: z.string().default(''),
  enabled: z.boolean().default(false),
});

export const AiSettingsSchema = z.object({
  base_url: z.string().default('https://api.openai.com/v1'),
  model: z.string().default('gpt-5.6-luna'),
  effort: z.enum(['low', 'medium', 'high']).default('medium'),
  daily_cap: z.number().int().default(500),
  extra_headers: z.record(z.string(), z.string()).optional(),
});

export const ChecklistSelectionSchema = z.looseObject({
  title: z.string(),
  due_at: z.string().nullable().default(null),
});

export const WizardStateSchema = z.object({
  completed: z.boolean().default(false),
  skipped_steps: z.array(z.string()).default([]),
  current_step: z.number().int().default(1),
  pending_checklist: z.array(ChecklistSelectionSchema).optional(),
});

export const UiSettingsSchema = z.object({
  setup_dismissed: z.array(z.string()).default([]),
});

export const AppSettingsSchema = z.object({
  timezone: z.string().default('UTC'),
  quiet_hours: QuietHoursSchema.default({ start: '22:00', end: '08:00' }),
  notification_prefs: NotificationPrefsSchema.default({
    digest_enabled: true,
    digest_time: '08:00',
    channels: { urgent: ['in_app', 'email', 'sms'], normal: ['in_app', 'email'], low: ['in_app'] },
  }),
  imap: ImapSettingsSchema.default({
    host: '', port: 993, tls: true, username: '', mailbox: 'INBOX',
    poll_interval_minutes: 5, enabled: false, auto_accept_events: false,
    last_uid: 0, uidvalidity: null, last_poll_at: null, last_error: null,
  }),
  smtp: SmtpSettingsSchema.default({
    host: '', port: 465, security: 'tls', username: '', from_address: '', personal_email: '', enabled: false,
  }),
  twilio: TwilioSettingsSchema.default({ account_sid: '', from_number: '', to_number: '', enabled: false }),
  ai: AiSettingsSchema.default({
    base_url: 'https://api.openai.com/v1', model: 'gpt-5.6-luna', effort: 'medium', daily_cap: 500,
  }),
  wizard_state: WizardStateSchema.default({ completed: false, skipped_steps: [], current_step: 1 }),
  ui: UiSettingsSchema.default({ setup_dismissed: [] }),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export type SettingsPatch = {
  [K in keyof AppSettings]?: AppSettings[K] extends Record<string, unknown> ? Partial<AppSettings[K]> : AppSettings[K];
};

export const UpdateSettingsSchema = z.object({
  timezone: z.string().optional(),
  quiet_hours: QuietHoursSchema.partial().optional(),
  notification_prefs: NotificationPrefsSchema.partial().optional(),
  imap: ImapSettingsSchema.partial().optional(),
  smtp: SmtpSettingsSchema.partial().optional(),
  twilio: TwilioSettingsSchema.partial().optional(),
  ai: AiSettingsSchema.partial().optional(),
  wizard_state: WizardStateSchema.partial().optional(),
  ui: UiSettingsSchema.partial().optional(),
});

import { z } from 'zod';

export const EffortSchema = z.enum(['low', 'medium', 'high']);
export const ChannelSchema = z.enum(['in_app', 'email', 'sms']);
export const channelSchema = ChannelSchema;
export const ImportanceSchema = z.enum(['low', 'normal', 'urgent']);
export const TaskCategorySchema = z.enum([
  'transcript', 'vaccine', 'financial_aid', 'housing', 'advising', 'registration', 'payment', 'other',
]);

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 22:00');

export const QuietHoursSchema = z.object({
  start: timeOfDay.default('22:00'),
  end: timeOfDay.default('08:00'),
});

const DefaultChannelMap = {
  urgent: ['in_app', 'email', 'sms'] as const,
  normal: ['in_app', 'email'] as const,
  low: ['in_app'] as const,
};

export const NotificationPrefsSchema = z.object({
  urgent: z.array(ChannelSchema).default([...DefaultChannelMap.urgent]),
  normal: z.array(ChannelSchema).default([...DefaultChannelMap.normal]),
  low: z.array(ChannelSchema).default([...DefaultChannelMap.low]),
  digest_enabled: z.boolean().default(true),
  digest_time: timeOfDay.default('08:00'),
  // Kept for Phase 1 data compatibility. New code reads the direct keys above.
  channels: z.object({
    urgent: z.array(ChannelSchema),
    normal: z.array(ChannelSchema),
    low: z.array(ChannelSchema),
  }).default({
    urgent: [...DefaultChannelMap.urgent],
    normal: [...DefaultChannelMap.normal],
    low: [...DefaultChannelMap.low],
  }),
});

export const AiSettingsSchema = z.object({
  base_url: z.string().url(),
  model: z.string().min(1),
  effort: EffortSchema,
  daily_cap: z.number().int().positive().optional(),
  extra_headers: z.record(z.string(), z.string()).optional(),
});

export const ImapSettingsSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  tls: z.boolean(),
  username: z.string().min(1),
  mailbox: z.string().min(1),
  enabled: z.boolean(),
}).passthrough();

export const SmtpSecuritySchema = z.enum(['tls', 'starttls', 'none']);
export const SmtpSettingsSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  security: SmtpSecuritySchema,
  username: z.string().min(1),
  from_address: z.string().min(1),
  personal_email: z.string().email(),
  enabled: z.boolean(),
}).passthrough();

export const TwilioSettingsSchema = z.object({
  account_sid: z.string().min(1),
  from_number: z.string().min(1),
  to_number: z.string().min(1),
  enabled: z.boolean(),
}).passthrough();

export const PendingChecklistItemSchema = z.object({
  title: z.string().min(1),
  category: TaskCategorySchema,
  due_at: z.string().nullable(),
}).loose();
export const ChecklistSelectionSchema = PendingChecklistItemSchema;
export type PendingChecklistItem = z.infer<typeof PendingChecklistItemSchema>;

export const WizardStateSchema = z.object({
  completed: z.boolean().default(false),
  skipped_steps: z.array(z.string()).default([]),
  current_step: z.number().int().min(1).max(10).default(1),
  pending_checklist: z.array(PendingChecklistItemSchema).optional(),
});
export type WizardState = z.infer<typeof WizardStateSchema>;

export const UiSettingsSchema = z.object({
  setup_dismissed: z.array(z.string()).default([]),
}).passthrough();

export const DegreeProfileSchema = z.object({
  institution: z.string(),
  program: z.string(),
  catalog_year: z.string(),
});

export const SettingsPatchSchema = z.object({
  timezone: z.string().min(1).optional(),
  quiet_hours: QuietHoursSchema.optional(),
  notification_prefs: NotificationPrefsSchema.optional(),
  ai: AiSettingsSchema.partial().optional(),
  imap: ImapSettingsSchema.partial().optional(),
  smtp: SmtpSettingsSchema.partial().optional(),
  twilio: TwilioSettingsSchema.partial().optional(),
  wizard_state: WizardStateSchema.optional(),
  ui: UiSettingsSchema.optional(),
  degree_profile: DegreeProfileSchema.optional(),
}).strict();

export const SecretNameSchema = z.enum(['ai.api_key', 'imap.password', 'smtp.password', 'twilio.auth_token']);
export const SecretPutSchema = z.object({ name: SecretNameSchema, value: z.string().min(1).max(500) });

const StoredImapSettingsSchema = z.object({
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
}).passthrough();

const StoredSmtpSettingsSchema = z.object({
  host: z.string().default(''),
  port: z.number().int().default(465),
  security: SmtpSecuritySchema.default('tls'),
  username: z.string().default(''),
  from_address: z.string().default(''),
  personal_email: z.string().default(''),
  enabled: z.boolean().default(false),
}).passthrough();

const StoredTwilioSettingsSchema = z.object({
  account_sid: z.string().default(''),
  from_number: z.string().default(''),
  to_number: z.string().default(''),
  enabled: z.boolean().default(false),
}).passthrough();

const StoredAiSettingsSchema = z.object({
  base_url: z.string().default('https://api.openai.com/v1'),
  model: z.string().default('gpt-5.6-luna'),
  effort: EffortSchema.default('medium'),
  daily_cap: z.number().int().default(500),
  extra_headers: z.record(z.string(), z.string()).optional(),
});

export const AppSettingsSchema = z.object({
  timezone: z.string().default('UTC'),
  quiet_hours: QuietHoursSchema.default({ start: '22:00', end: '08:00' }),
  notification_prefs: NotificationPrefsSchema.default({
    urgent: [...DefaultChannelMap.urgent],
    normal: [...DefaultChannelMap.normal],
    low: [...DefaultChannelMap.low],
    digest_enabled: true,
    digest_time: '08:00',
    channels: {
      urgent: [...DefaultChannelMap.urgent],
      normal: [...DefaultChannelMap.normal],
      low: [...DefaultChannelMap.low],
    },
  }),
  imap: StoredImapSettingsSchema.default({
    host: '', port: 993, tls: true, username: '', mailbox: 'INBOX',
    poll_interval_minutes: 5, enabled: false, auto_accept_events: false,
    last_uid: 0, uidvalidity: null, last_poll_at: null, last_error: null,
  }),
  smtp: StoredSmtpSettingsSchema.default({
    host: '', port: 465, security: 'tls', username: '', from_address: '', personal_email: '', enabled: false,
  }),
  twilio: StoredTwilioSettingsSchema.default({ account_sid: '', from_number: '', to_number: '', enabled: false }),
  ai: StoredAiSettingsSchema.default({
    base_url: 'https://api.openai.com/v1', model: 'gpt-5.6-luna', effort: 'medium', daily_cap: 500,
  }),
  wizard_state: WizardStateSchema.default({ completed: false, skipped_steps: [], current_step: 1 }),
  ui: UiSettingsSchema.default({ setup_dismissed: [] }),
  degree_profile: DegreeProfileSchema.optional(),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type SettingsPatch = {
  [K in keyof AppSettings]?: AppSettings[K] extends Record<string, unknown> ? Partial<AppSettings[K]> : AppSettings[K];
};

export const UpdateSettingsSchema = z.object({
  timezone: z.string().optional(),
  quiet_hours: QuietHoursSchema.partial().optional(),
  notification_prefs: NotificationPrefsSchema.partial().optional(),
  imap: StoredImapSettingsSchema.partial().optional(),
  smtp: StoredSmtpSettingsSchema.partial().optional(),
  twilio: StoredTwilioSettingsSchema.partial().optional(),
  ai: StoredAiSettingsSchema.partial().optional(),
  wizard_state: WizardStateSchema.partial().optional(),
  ui: UiSettingsSchema.partial().optional(),
  degree_profile: DegreeProfileSchema.optional(),
});

export interface SettingsSnapshot {
  timezone?: string;
  quiet_hours?: z.infer<typeof QuietHoursSchema>;
  notification_prefs?: z.infer<typeof NotificationPrefsSchema>;
  ai?: { base_url?: string; model?: string; effort?: z.infer<typeof EffortSchema>; daily_cap?: number };
  imap?: { host?: string; port?: number; tls?: boolean; username?: string; mailbox?: string; poll_interval_minutes?: number; enabled?: boolean; last_error?: string | null };
  smtp?: { host?: string; port?: number; security?: z.infer<typeof SmtpSecuritySchema>; username?: string; from_address?: string; personal_email?: string; enabled?: boolean };
  twilio?: { account_sid?: string; from_number?: string; to_number?: string; enabled?: boolean };
  wizard_state?: WizardState;
  ui?: { setup_dismissed?: string[] };
  degree_profile?: z.infer<typeof DegreeProfileSchema>;
}

export const STANDARD_CHECKLIST: ReadonlyArray<{ title: string; category: z.infer<typeof TaskCategorySchema> }> = [
  { title: 'Send your final high-school transcript', category: 'transcript' },
  { title: 'Submit immunization / vaccine records', category: 'vaccine' },
  { title: 'Accept financial aid / complete FAFSA', category: 'financial_aid' },
  { title: 'Pay the housing deposit', category: 'housing' },
  { title: 'Register for orientation', category: 'other' },
  { title: 'Meet your academic advisor', category: 'advising' },
];

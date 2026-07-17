import { z } from 'zod';

export const TASK_CATEGORY_VALUES = [
  'transcript', 'vaccine', 'financial_aid', 'housing',
  'advising', 'registration', 'payment', 'other',
] as const;
export const TASK_STATUS_VALUES = [
  'pending', 'awaiting_confirmation', 'completed', 'dismissed',
] as const;
export const TASK_SOURCE_VALUES = [
  'wizard', 'manual', 'email', 'redi', 'mcp', 'system',
] as const;

export const taskCategorySchema = z.enum(TASK_CATEGORY_VALUES);
export const taskStatusSchema = z.enum(TASK_STATUS_VALUES);

export const reminderPolicySchema = z.object({
  offsets_days: z.array(z.number().int().min(0).max(365)).min(1),
  overdue_daily_days: z.number().int().min(0).max(30),
  awaiting_renag_days: z.number().int().min(1).max(90),
});
export type ReminderPolicy = z.infer<typeof reminderPolicySchema>;

export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  offsets_days: [7, 1, 0],
  overdue_daily_days: 3,
  awaiting_renag_days: 7,
};

const dueAtInput = z.string().min(10).refine(
  (value) => !Number.isNaN(Date.parse(value.length === 10 ? `${value}T23:59:59.999Z` : value)),
  { message: 'due_at must be an ISO date (YYYY-MM-DD) or datetime' },
);

export const createTaskParamsSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullish(),
  category: taskCategorySchema.default('other'),
  due_at: dueAtInput.nullish(),
  reminder_policy: reminderPolicySchema.nullish(),
  source: z.enum(TASK_SOURCE_VALUES).default('manual'),
  source_email_id: z.string().nullish(),
});

export const updateTaskParamsSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullish(),
  category: taskCategorySchema.optional(),
  status: z.enum(['pending', 'awaiting_confirmation']).optional(),
  due_at: dueAtInput.nullish(),
  reminder_policy: reminderPolicySchema.nullish(),
});

export const listTaskParamsSchema = z.object({
  status: taskStatusSchema.optional(),
  category: taskCategorySchema.optional(),
  due: z.enum(['overdue', 'today', 'next_7_days']).optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

export const taskIdParamsSchema = z.object({ id: z.string().min(1) });
export const deleteTaskParamsSchema = z.object({
  id: z.string().min(1),
  confirm: z.literal(true),
});

export const pendingChecklistEntrySchema = z.object({
  key: z.string().min(1).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullish(),
  category: taskCategorySchema.default('other'),
  due_at: dueAtInput.nullish(),
  materialized: z.boolean().optional(),
}).loose();

export function normalizeDueAt(value: string): string {
  return new Date(value.length === 10 ? `${value}T23:59:59.999Z` : value).toISOString();
}

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function validDueAt(value: string): boolean {
  const date = value.slice(0, 10);
  if (!ISO_DATE.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month! - 1
    || parsedDate.getUTCDate() !== day
  ) return false;
  return value.length === 10
    ? true
    : ISO_DATETIME_WITH_ZONE.test(value) && !Number.isNaN(Date.parse(value));
}

export const dueAtInputSchema = z.string().min(10).refine(
  validDueAt,
  { message: 'due_at must be an ISO date (YYYY-MM-DD) or datetime' },
);

export const createTaskParamsSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullish(),
  category: taskCategorySchema.default('other'),
  due_at: dueAtInputSchema.nullish(),
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
  due_at: dueAtInputSchema.nullish(),
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
  due_at: dueAtInputSchema.nullish(),
  materialized: z.boolean().optional(),
}).loose();

export function normalizeDueAt(value: string): string {
  return new Date(value.length === 10 ? `${value}T23:59:59.999Z` : value).toISOString();
}

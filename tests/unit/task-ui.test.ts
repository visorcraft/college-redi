import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('task lifecycle UI', () => {
  it('exposes task detail, reminder, edit/delete, and terminal history controls', () => {
    const source = readFileSync('src/app/tasks/page.tsx', 'utf8');
    for (const field of [
      'name="description"',
      'name="custom_reminders"',
      'name="offsets_days"',
      'name="overdue_daily_days"',
      'name="awaiting_renag_days"',
    ]) {
      expect(source).toContain(field);
    }
    expect(source).toContain("method: 'PATCH'");
    expect(source).toContain("method: 'DELETE'");
    expect(source).toContain("task.status === 'completed' || task.status === 'dismissed'");
    expect(source).toContain('aria-label="task history"');
  });
});

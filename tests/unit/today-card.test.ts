import { describe, expect, it } from 'vitest';
import { mergeTodayTasks } from '@/components/ui/TodayCard';

describe('TodayCard', () => {
  it('shows a task once when it is both overdue and due today', () => {
    const task = { id: 't1', title: 'Pay deposit', due_at: '2026-07-18T08:00:00.000Z' };
    expect(mergeTodayTasks([task], [task])).toEqual([task]);
  });
});

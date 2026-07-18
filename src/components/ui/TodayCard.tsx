'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Task {
  id: string;
  title: string;
  due_at: string | null;
}

export function mergeTodayTasks(overdue: Task[], today: Task[]): Task[] {
  return [...new Map([...overdue, ...today].map((task) => [task.id, task])).values()];
}

export function TodayCard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    void (async () => {
      const [overdue, today] = await Promise.all([
        fetch('/api/tasks?due=overdue'),
        fetch('/api/tasks?due=today'),
      ]);
      if (!overdue.ok || !today.ok) throw new Error('Task request failed');
      const overdueTasks = (await overdue.json()) as Task[];
      const todayTasks = (await today.json()) as Task[];
      setTasks(mergeTodayTasks(overdueTasks, todayTasks));
      setStatus('ready');
    })().catch(() => setStatus('error'));
  }, []);

  const nowIso = new Date().toISOString();
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" aria-label="Today">
      <h2 className="text-lg font-semibold text-[#1F2D50]">Today</h2>
      {status === 'loading' ? (
        <p className="mt-2 text-sm text-[#1F2D50]/60" role="status">Loading tasks…</p>
      ) : status === 'error' ? (
        <p className="mt-2 text-sm text-red-700" role="alert">Could not load today’s tasks.</p>
      ) : tasks.length === 0 ? (
        <p className="mt-2 text-sm text-[#1F2D50]/60">
          Nothing due today. Enjoy the calm. ☁️
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {tasks.map((task) => (
            <li
              key={task.id}
              className={`text-sm ${
                task.due_at && task.due_at < nowIso
                  ? 'font-semibold text-red-600'
                  : 'text-[#1F2D50]'
              }`}
            >
              • {task.title}
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/tasks"
        className="mt-3 inline-block text-sm font-medium text-[#1F2D50] underline"
      >
        Open tasks
      </Link>
    </section>
  );
}

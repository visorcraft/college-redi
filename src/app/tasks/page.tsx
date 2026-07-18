'use client';

import { useCallback, useEffect, useState } from 'react';
import { csrfHeaders } from '../../components/degree/api';

interface ReminderPolicy {
  offsets_days: number[];
  overdue_daily_days: number;
  awaiting_renag_days: number;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: 'pending' | 'awaiting_confirmation' | 'completed' | 'dismissed';
  due_at: string | null;
  reminder_policy: ReminderPolicy | null;
  updated_at: string;
  completed_at: string | null;
}

const LABELS: Record<string, string> = {
  transcript: 'Transcripts',
  vaccine: 'Vaccine records',
  financial_aid: 'Financial aid',
  housing: 'Housing',
  advising: 'Advising',
  registration: 'Registration',
  payment: 'Payments',
  other: 'Other',
};
const ORDER = [
  'transcript', 'vaccine', 'financial_aid', 'housing',
  'advising', 'registration', 'payment', 'other',
];
const inputClass = 'rounded-xl border border-[#1F2D50]/20 px-3 py-2';
const primaryButton = 'rounded-xl bg-[#1F2D50] px-4 py-2 text-sm font-semibold text-white';

function ReminderPolicyFields({ policy }: { policy?: ReminderPolicy | null }) {
  const [enabled, setEnabled] = useState(Boolean(policy));
  return (
    <fieldset className="rounded-xl border border-[#1F2D50]/10 p-3 sm:col-span-2">
      <label className="flex items-center gap-2 text-sm font-medium text-[#1F2D50]">
        <input
          type="checkbox"
          name="custom_reminders"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Override default reminders
      </label>
      {enabled && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-[#1F2D50]/70">
            Days before due
            <input
              name="offsets_days"
              required
              defaultValue={policy?.offsets_days.join(', ') ?? '7, 1, 0'}
              placeholder="7, 1, 0"
              className={inputClass + ' mt-1 w-full'}
            />
          </label>
          <label className="text-xs text-[#1F2D50]/70">
            Overdue daily days
            <input
              name="overdue_daily_days"
              type="number"
              min={0}
              max={30}
              required
              defaultValue={policy?.overdue_daily_days ?? 3}
              className={inputClass + ' mt-1 w-full'}
            />
          </label>
          <label className="text-xs text-[#1F2D50]/70">
            Waiting re-nag days
            <input
              name="awaiting_renag_days"
              type="number"
              min={1}
              max={90}
              required
              defaultValue={policy?.awaiting_renag_days ?? 7}
              className={inputClass + ' mt-1 w-full'}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}

function taskPayload(form: HTMLFormElement) {
  const data = new FormData(form);
  const custom = data.get('custom_reminders') === 'on';
  return {
    title: String(data.get('title') ?? '').trim(),
    description: String(data.get('description') ?? '').trim() || null,
    category: String(data.get('category') ?? 'other'),
    due_at: String(data.get('due_at') ?? '') || null,
    reminder_policy: custom ? {
      offsets_days: String(data.get('offsets_days') ?? '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter(Number.isFinite),
      overdue_daily_days: Number(data.get('overdue_daily_days') ?? 3),
      awaiting_renag_days: Number(data.get('awaiting_renag_days') ?? 7),
    } : null,
  };
}

type Act = (request: () => Promise<Response>) => Promise<boolean>;

function TaskCard({ task, act }: { task: Task; act: Act }) {
  const [editing, setEditing] = useState(false);
  const terminal = task.status === 'completed' || task.status === 'dismissed';

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await act(() => fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(taskPayload(event.currentTarget)),
    }))) setEditing(false);
  }

  async function remove() {
    if (!window.confirm(`Permanently delete "${task.title}"?`)) return;
    await act(() => fetch(`/api/tasks/${task.id}`, {
      method: 'DELETE',
      headers: csrfHeaders(),
    }));
  }

  if (editing) {
    return (
      <li className="rounded-2xl bg-white p-4 shadow-sm">
        <form aria-label={`edit ${task.title}`} onSubmit={save} className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm text-[#1F2D50]">
            Title
            <input name="title" required maxLength={200} defaultValue={task.title} className={inputClass + ' mt-1 w-full'} />
          </label>
          <label className="text-sm text-[#1F2D50]">
            Category
            <select name="category" defaultValue={task.category} className={inputClass + ' mt-1 w-full'}>
              {ORDER.map((item) => <option key={item} value={item}>{LABELS[item]}</option>)}
            </select>
          </label>
          <label className="text-sm text-[#1F2D50] sm:col-span-2">
            Description
            <textarea name="description" rows={3} maxLength={4000} defaultValue={task.description ?? ''} className={inputClass + ' mt-1 w-full'} />
          </label>
          <label className="text-sm text-[#1F2D50]">
            Due date
            <input name="due_at" type="date" defaultValue={task.due_at?.slice(0, 10) ?? ''} className={inputClass + ' mt-1 w-full'} />
          </label>
          <ReminderPolicyFields policy={task.reminder_policy} />
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" className={primaryButton}>Save task</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-xl bg-[#EAF3FB] px-4 py-2 text-sm font-medium text-[#1F2D50]">Cancel</button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-[#1F2D50]">{task.title}</p>
          {terminal && (
            <span className="rounded-full bg-[#EAF3FB] px-2 py-0.5 text-xs text-[#1F2D50]">
              {task.status}
            </span>
          )}
        </div>
        {task.description && <p className="mt-1 whitespace-pre-wrap text-sm text-[#1F2D50]/75">{task.description}</p>}
        <p className="mt-1 text-xs text-[#1F2D50]/60">
          {task.due_at ? `Due ${task.due_at.slice(0, 10)}` : 'No due date'}
          {task.status === 'awaiting_confirmation'
            && ' · Waiting on them. Redi will keep checking in.'}
          {terminal && ` · Updated ${task.updated_at.slice(0, 10)}`}
        </p>
        <p className="mt-1 text-xs text-[#1F2D50]/60">
          {task.reminder_policy
            ? `Custom reminders: ${task.reminder_policy.offsets_days.join(', ')} day(s) before; ${task.reminder_policy.overdue_daily_days} overdue day(s); re-nag every ${task.reminder_policy.awaiting_renag_days} day(s)`
            : 'Default reminders'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!terminal && task.status === 'pending' && (
          <button
            type="button"
            onClick={() => void act(() => fetch(`/api/tasks/${task.id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json', ...csrfHeaders() },
              body: JSON.stringify({ status: 'awaiting_confirmation' }),
            }))}
            className="rounded-xl border border-[#1F2D50]/30 px-3 py-1 text-xs text-[#1F2D50]"
          >
            I sent it
          </button>
        )}
        {!terminal && (
          <>
            <button
              type="button"
              onClick={() => void act(() => fetch(`/api/tasks/${task.id}/complete`, {
                method: 'POST',
                headers: csrfHeaders(),
              }))}
              className="rounded-xl bg-[#FFC24B] px-3 py-1 text-xs font-semibold text-[#1F2D50]"
            >
              Done
            </button>
            <button
              type="button"
              onClick={() => void act(() => fetch(`/api/tasks/${task.id}/dismiss`, {
                method: 'POST',
                headers: csrfHeaders(),
              }))}
              className="rounded-xl px-3 py-1 text-xs text-[#1F2D50]/60"
            >
              Dismiss
            </button>
          </>
        )}
        <button type="button" onClick={() => setEditing(true)} className="rounded-xl px-3 py-1 text-xs text-[#1F2D50] underline">Edit</button>
        <button type="button" onClick={remove} className="rounded-xl px-3 py-1 text-xs text-[#B3261E] underline">Delete</button>
      </div>
    </li>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/tasks');
    if (!response.ok) throw new Error('Could not load tasks.');
    setTasks(await response.json());
  }, []);
  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [load]);

  const act: Act = async (request) => {
    try {
      const response = await request();
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Something went wrong. Please try again.');
      }
      setError('');
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const open = tasks.filter((task) =>
    task.status === 'pending' || task.status === 'awaiting_confirmation');
  const history = tasks
    .filter((task) => task.status === 'completed' || task.status === 'dismissed')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-[#1F2D50]">Tasks</h1>
      <p className="mt-1 text-sm text-[#1F2D50]/70">
        Everything you still owe the school, in one place.
      </p>
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form
        aria-label="add task"
        className="mt-4 grid gap-2 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          if (await act(() => fetch('/api/tasks', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...csrfHeaders() },
            body: JSON.stringify(taskPayload(form)),
          }))) form.reset();
        }}
      >
        <label className="text-sm text-[#1F2D50]">
          Task title
          <input name="title" required maxLength={200} placeholder="e.g. Send final transcript" className={inputClass + ' mt-1 w-full'} />
        </label>
        <label className="text-sm text-[#1F2D50]">
          Category
          <select name="category" defaultValue="other" className={inputClass + ' mt-1 w-full'}>
            {ORDER.map((item) => <option key={item} value={item}>{LABELS[item]}</option>)}
          </select>
        </label>
        <label className="text-sm text-[#1F2D50] sm:col-span-2">
          Description
          <textarea name="description" rows={3} maxLength={4000} placeholder="Notes, instructions, or who you need to contact" className={inputClass + ' mt-1 w-full'} />
        </label>
        <label className="text-sm text-[#1F2D50]">
          Due date
          <input name="due_at" type="date" className={inputClass + ' mt-1 w-full'} />
        </label>
        <ReminderPolicyFields />
        <button type="submit" className={primaryButton + ' sm:col-span-2 sm:justify-self-start'}>Add</button>
      </form>

      {ORDER.map((item) => {
        const group = open.filter((task) => task.category === item);
        if (group.length === 0) return null;
        return (
          <section key={item} className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#1F2D50]/60">
              {LABELS[item]}
            </h2>
            <ul className="mt-2 space-y-2">
              {group.map((task) => <TaskCard key={task.id} task={task} act={act} />)}
            </ul>
          </section>
        );
      })}
      {open.length === 0 && (
        <p className="mt-8 text-center text-[#1F2D50]/60">
          All clear. Nothing on your plate. ☁️
        </p>
      )}

      <section aria-label="task history" className="mt-8 border-t border-[#1F2D50]/10 pt-6">
        <h2 className="text-lg font-semibold text-[#1F2D50]">Completed and dismissed</h2>
        {history.length === 0
          ? <p className="mt-2 text-sm text-[#1F2D50]/60">No task history yet.</p>
          : <ul className="mt-3 space-y-2">{history.map((task) => <TaskCard key={task.id} task={task} act={act} />)}</ul>}
      </section>
    </main>
  );
}

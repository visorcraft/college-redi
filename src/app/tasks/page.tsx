'use client';

import { useCallback, useEffect, useState } from 'react';
import { csrfHeaders } from '../../components/degree/api';

interface Task {
  id: string;
  title: string;
  category: string;
  status: string;
  due_at: string | null;
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
  'transcript',
  'vaccine',
  'financial_aid',
  'housing',
  'advising',
  'registration',
  'payment',
  'other',
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('other');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/tasks');
    if (res.ok) setTasks(await res.json());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<Response>) => {
    const res = await fn();
    setError(res.ok ? '' : 'Something went wrong. Please try again.');
    await load();
  };

  const open = tasks.filter((task) =>
    task.status === 'pending' || task.status === 'awaiting_confirmation');

  return (
    <main className="mx-auto max-w-3xl p-6">
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
        className="mt-4 flex flex-wrap gap-2 rounded-2xl bg-white p-4 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          void act(() => fetch('/api/tasks', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...csrfHeaders() },
            body: JSON.stringify({ title: title.trim(), category, due_at: due || null }),
          })).then(() => {
            setTitle('');
            setDue('');
          });
        }}
      >
        <input
          aria-label="Task title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Send final transcript"
          className="min-w-0 flex-1 rounded-xl border border-[#1F2D50]/20 px-3 py-2"
        />
        <select
          aria-label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="rounded-xl border border-[#1F2D50]/20 px-2 py-2"
        >
          {ORDER.map((item) => <option key={item} value={item}>{LABELS[item]}</option>)}
        </select>
        <input
          aria-label="Due date"
          type="date"
          value={due}
          onChange={(event) => setDue(event.target.value)}
          className="rounded-xl border border-[#1F2D50]/20 px-2 py-2"
        />
        <button
          type="submit"
          className="rounded-xl bg-[#1F2D50] px-4 py-2 font-semibold text-white"
        >
          Add
        </button>
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
              {group.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[#1F2D50]">{task.title}</p>
                    <p className="text-xs text-[#1F2D50]/60">
                      {task.due_at ? `Due ${task.due_at.slice(0, 10)}` : 'No due date'}
                      {task.status === 'awaiting_confirmation'
                        && ' · Waiting on them. Redi re-nags every 7 days until you confirm.'}
                    </p>
                  </div>
                  {task.status === 'pending' && (
                    <button
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
                  <button
                    onClick={() => void act(() => fetch(`/api/tasks/${task.id}/complete`, {
                      method: 'POST',
                      headers: csrfHeaders(),
                    }))}
                    className="rounded-xl bg-[#FFC24B] px-3 py-1 text-xs font-semibold text-[#1F2D50]"
                  >
                    Done
                  </button>
                  <button
                    onClick={() => void act(() => fetch(`/api/tasks/${task.id}/dismiss`, {
                      method: 'POST',
                      headers: csrfHeaders(),
                    }))}
                    className="rounded-xl px-3 py-1 text-xs text-[#1F2D50]/50"
                  >
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {open.length === 0 && (
        <p className="mt-8 text-center text-[#1F2D50]/60">
          All clear. Nothing on your plate. ☁️
        </p>
      )}
    </main>
  );
}

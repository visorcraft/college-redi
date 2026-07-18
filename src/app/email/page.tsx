'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type ProcessedEmail = {
  id: string;
  from_addr: string;
  subject: string;
  received_at: string;
  classification: string;
  summary: string | null;
  extracted_count: number;
};
type ReviewEvent = {
  id: string;
  title: string;
  event_type: string;
  due_at: string | null;
  confidence: number;
  email_subject: string;
  email_from: string;
};
type SenderRule = {
  id: string;
  pattern: string;
  action: 'junk' | 'important';
};

const BADGE: Record<string, string> = {
  actionable: 'bg-[#FFC24B] text-[#1F2D50]',
  informational: 'border border-[#1F2D50]/20 bg-[#EAF3FB] text-[#1F2D50]',
  junk: 'bg-gray-200 text-gray-500',
  unprocessed: 'border border-dashed border-[#1F2D50]/40 bg-white text-[#1F2D50]',
};
const FILTERS = ['all', 'actionable', 'informational', 'junk', 'unprocessed'] as const;

export default function EmailPage() {
  const [emails, setEmails] = useState<ProcessedEmail[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [rules, setRules] = useState<SenderRule[]>([]);
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<'junk' | 'important'>('junk');
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const query = filter === 'all' ? '' : `?classification=${filter}`;
    const [processed, review, senderRules] = await Promise.all([
      fetch(`/api/email/processed${query}`).then((res) => res.json()),
      fetch('/api/events?status=pending_review').then((res) => res.json()),
      fetch('/api/email/sender-rules').then((res) => res.json()),
    ]);
    setEmails(processed.emails ?? []);
    setTotal(processed.total ?? 0);
    setEvents(review.events ?? []);
    setRules(senderRules.rules ?? []);
  }, [filter]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  async function checkNow() {
    setChecking(true);
    setNotice('');
    try {
      const result = await apiFetch('/api/email/check', { method: 'POST' });
      setNotice(result.configured === false
        ? 'College inbox is not connected yet. Set it up in Settings.'
        : `Checked: ${result.fetched} new · ${result.actionable} actionable · ${result.junk} junk.`);
    } catch {
      setNotice('Check failed. See Settings → Status.');
    }
    setChecking(false);
    await load();
  }

  async function reviewEvent(id: string, verb: 'accept' | 'dismiss') {
    await apiFetch(`/api/events/${id}/${verb}`, { method: 'POST', body: {} });
    await load();
  }

  async function addRule() {
    if (!pattern.trim()) return;
    await apiFetch('/api/email/sender-rules', {
      method: 'POST',
      body: { pattern: pattern.trim(), action },
    });
    setPattern('');
    await load();
  }

  async function removeRule(id: string) {
    await apiFetch(`/api/email/sender-rules/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl p-4 text-[#1F2D50] sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">College email</h1>
        <button
          onClick={() => void checkNow()}
          disabled={checking}
          className="rounded-xl bg-[#1F2D50] px-4 py-2 text-white disabled:opacity-50"
        >
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {notice && <p className="mb-4 rounded-xl bg-[#EAF3FB] p-3 text-sm">{notice}</p>}

      <section aria-labelledby="review" className="mb-8">
        <h2 id="review" className="mb-2 text-lg font-semibold">
          Review deadlines ({events.length})
        </h2>
        {events.length === 0 && (
          <p className="text-sm opacity-70">
            Nothing waiting for review. Redi will put possible deadlines here.
          </p>
        )}
        <ul className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex min-w-0 flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="break-words font-medium">{event.title}</p>
                <p className="break-words text-sm opacity-70">
                  {event.due_at
                    ? new Date(event.due_at).toLocaleString()
                    : 'date needs confirmation'}{' '}
                  · {Math.round(event.confidence * 100)}% sure · from “{event.email_subject}”
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  onClick={() => void reviewEvent(event.id, 'accept')}
                  className="rounded-xl bg-[#1F2D50] px-3 py-1 text-sm text-white"
                >
                  Accept
                </button>
                <button
                  onClick={() => void reviewEvent(event.id, 'dismiss')}
                  className="rounded-xl border border-[#1F2D50]/30 px-3 py-1 text-sm"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="processed" className="mb-8">
        <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="processed" className="text-lg font-semibold">Processed ({total})</h2>
          <div className="flex max-w-full flex-wrap gap-1">
            {FILTERS.map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`rounded-full px-3 py-1 text-sm ${
                  filter === item ? 'bg-[#1F2D50] text-white' : 'bg-[#EAF3FB]'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        {emails.length === 0 && <p className="text-sm opacity-70">No emails processed yet.</p>}
        <ul className="space-y-2">
          {emails.map((email) => (
            <li key={email.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  BADGE[email.classification] ?? BADGE.unprocessed
                }`}
                >
                  {email.classification}
                </span>
                <p className="min-w-0 break-words font-medium">{email.subject}</p>
              </div>
              <p className="break-all text-sm opacity-70">
                {email.from_addr} · {new Date(email.received_at).toLocaleString()}
              </p>
              {email.summary && <p className="mt-1 break-words text-sm">{email.summary}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="rules">
        <h2 id="rules" className="mb-2 text-lg font-semibold">Sender rules</h2>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            placeholder="address or domain, e.g. spammy.edu"
            className="min-w-0 flex-1 rounded-xl border border-[#1F2D50]/20 px-3 py-2"
            aria-label="Sender pattern"
          />
          <select
            value={action}
            onChange={(event) => setAction(event.target.value as 'junk' | 'important')}
            className="w-full rounded-xl border border-[#1F2D50]/20 px-3 py-2 sm:w-auto"
            aria-label="Rule action"
          >
            <option value="junk">always junk</option>
            <option value="important">always important</option>
          </select>
          <button
            onClick={() => void addRule()}
            className="rounded-xl bg-[#1F2D50] px-4 py-2 text-white"
          >
            Add
          </button>
        </div>
        <ul className="space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center justify-between rounded-2xl bg-white p-3 shadow-sm"
            >
              <p className="min-w-0 break-all text-sm">
                <span className="font-medium">{rule.pattern}</span> →{' '}
                {rule.action === 'junk' ? 'always junk' : 'always important'}
              </p>
              <button
                onClick={() => void removeRule(rule.id)}
                className="text-sm underline opacity-70"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

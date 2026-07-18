'use client';

import { useCallback, useEffect, useState } from 'react';
import { csrfHeaders } from '../../components/degree/api';

interface Item {
  id: string;
  title: string;
  body: string;
  importance: string;
  created_at: string;
  read: boolean;
  related_type: string | null;
  related_id: string | null;
}

interface HistoryItem {
  id: string;
  channel: string;
  destination: string;
  status: string;
  attempt: number;
  sent_at: string;
  notification_title: string | null;
  provider_response: unknown;
}

const linkFor = (item: Item) =>
  item.related_type === 'task'
    ? '/tasks'
    : item.related_type === 'term'
      ? '/degree'
      : '/notifications';

export default function NotificationsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [tab, setTab] = useState<'inbox' | 'history'>('inbox');
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [notifications, sentHistory] = await Promise.all([
      fetch('/api/notifications'),
      fetch('/api/notifications/history'),
    ]);
    if (notifications.ok) setItems((await notifications.json()).notifications);
    if (sentHistory.ok) setHistory(await sentHistory.json());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, {
      method: 'POST',
      headers: csrfHeaders(),
    });
    await load();
    window.dispatchEvent(new Event('redi:notifications-changed'));
  };
  const markAll = async () => {
    await fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: csrfHeaders(),
    });
    await load();
    window.dispatchEvent(new Event('redi:notifications-changed'));
  };
  const schedule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const channels = data.getAll('channels').map(String);
    if (channels.length === 0) {
      setScheduleMessage('Choose at least one delivery channel.');
      return;
    }
    const response = await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({
        title: String(data.get('title') ?? ''),
        body: String(data.get('body') ?? ''),
        scheduled_for: new Date(String(data.get('scheduled_for'))).toISOString(),
        importance: String(data.get('importance') ?? 'normal'),
        channels,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setScheduleMessage(result?.error?.message ?? 'Could not schedule reminder.');
      return;
    }
    form.reset();
    setScheduleMessage('Reminder scheduled.');
    await load();
  };
  const tabClass = (active: boolean) =>
    `rounded-xl px-3 py-1 text-sm ${active
      ? 'bg-[#1F2D50] text-white'
      : 'border border-[#1F2D50]/30 text-[#1F2D50]'}`;
  const formatTime = (iso: string) => iso.slice(0, 16).replace('T', ' ');

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-[#1F2D50]">Notifications</h1>
        <div className="flex gap-2">
          <button onClick={() => setTab('inbox')} className={tabClass(tab === 'inbox')}>
            Inbox
          </button>
          <button onClick={() => setTab('history')} className={tabClass(tab === 'history')}>
            Sent history
          </button>
          <button
            onClick={() => void markAll()}
            className="rounded-xl border border-[#1F2D50]/30 px-3 py-1 text-sm text-[#1F2D50]"
          >
            Mark all read
          </button>
        </div>
      </div>

      <section aria-labelledby="schedule-reminder" className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h2 id="schedule-reminder" className="font-semibold text-[#1F2D50]">Schedule a reminder</h2>
        <form onSubmit={schedule} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-[#1F2D50]">
            Title
            <input name="title" required maxLength={300} className="mt-1 w-full rounded-xl border border-[#1F2D50]/20 px-3 py-2" />
          </label>
          <label className="text-sm text-[#1F2D50]">
            When
            <input name="scheduled_for" required type="datetime-local" className="mt-1 w-full rounded-xl border border-[#1F2D50]/20 px-3 py-2" />
          </label>
          <label className="text-sm text-[#1F2D50] sm:col-span-2">
            Message
            <textarea name="body" required maxLength={8000} rows={2} className="mt-1 w-full rounded-xl border border-[#1F2D50]/20 px-3 py-2" />
          </label>
          <label className="text-sm text-[#1F2D50]">
            Importance
            <select name="importance" defaultValue="normal" className="mt-1 w-full rounded-xl border border-[#1F2D50]/20 px-3 py-2">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <fieldset className="text-sm text-[#1F2D50]">
            <legend>Send through</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="flex items-center gap-1"><input type="checkbox" name="channels" value="in_app" defaultChecked /> In app</label>
              <label className="flex items-center gap-1"><input type="checkbox" name="channels" value="email" /> Email</label>
              <label className="flex items-center gap-1"><input type="checkbox" name="channels" value="sms" /> SMS</label>
            </div>
          </fieldset>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button type="submit" className="rounded-xl bg-[#1F2D50] px-4 py-2 text-sm font-semibold text-white">
              Schedule reminder
            </button>
            {scheduleMessage && <p role="status" className="text-sm text-[#1F2D50]/70">{scheduleMessage}</p>}
          </div>
        </form>
      </section>

      {tab === 'inbox' ? (
        <ul className="mt-4 space-y-2" aria-label="Notifications">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={linkFor(item)}
                onClick={(event) => {
                  event.preventDefault();
                  void markRead(item.id).then(() => window.location.assign(linkFor(item)));
                }}
                className={`block rounded-2xl p-4 shadow-sm ${
                  item.read ? 'bg-white/60' : 'border-l-4 border-[#FFC24B] bg-white'
                }`}
              >
                <p className="font-medium text-[#1F2D50]">{item.title}</p>
                <p className="mt-1 whitespace-pre-line text-sm text-[#1F2D50]/70">
                  {item.body}
                </p>
                <p className="mt-1 text-xs text-[#1F2D50]/50">
                  {formatTime(item.created_at)} · {item.importance}
                </p>
              </a>
            </li>
          ))}
          {items.length === 0 && (
            <p className="mt-8 text-center text-[#1F2D50]/60">No notifications yet.</p>
          )}
        </ul>
      ) : (
        <ul className="mt-4 space-y-2" aria-label="Sent history">
          {history.map((item) => (
            <li key={item.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-[#1F2D50]">
                {item.notification_title ?? 'Notification'} · {item.channel}
              </p>
              <p className="text-xs text-[#1F2D50]/60">
                to {item.destination} · {item.status} · attempt {item.attempt} ·{' '}
                {formatTime(item.sent_at)}
              </p>
              {item.status === 'failed' && item.provider_response !== null && (
                <p className="mt-1 break-words text-xs text-red-700">
                  Provider detail: {typeof item.provider_response === 'string'
                    ? item.provider_response
                    : JSON.stringify(item.provider_response)}
                </p>
              )}
            </li>
          ))}
          {history.length === 0 && (
            <p className="mt-8 text-center text-[#1F2D50]/60">Nothing sent yet.</p>
          )}
        </ul>
      )}
    </main>
  );
}

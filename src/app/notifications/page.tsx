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
  };
  const markAll = async () => {
    await fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: csrfHeaders(),
    });
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

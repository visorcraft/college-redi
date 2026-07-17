'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface CardState {
  configured: boolean;
  count: number;
  latest: Array<{ id: string; subject: string; summary: string | null }>;
}

export default function CollegeInboxCard() {
  const [state, setState] = useState<CardState | null>(null);

  useEffect(() => {
    void (async () => {
      const settings = await fetch('/api/settings').then((res) => res.json());
      const imap = settings?.imap ?? settings?.payload?.imap;
      if (!imap?.enabled || !imap?.host) {
        setState({ configured: false, count: 0, latest: [] });
        return;
      }
      const since = encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      const data = await fetch(
        `/api/email/processed?classification=actionable&since=${since}&limit=3`,
      ).then((res) => res.json());
      setState({
        configured: true,
        count: data.total ?? 0,
        latest: (data.emails ?? []).slice(0, 3),
      });
    })().catch(() => setState({ configured: false, count: 0, latest: [] }));
  }, []);

  if (!state) return null;
  if (!state.configured) {
    return (
      <section className="rounded-2xl bg-white p-4 shadow-sm" aria-label="College inbox">
        <h2 className="font-semibold text-[#1F2D50]">College inbox</h2>
        <p className="mt-1 text-sm text-[#1F2D50]/70">
          Connect your school email and Redi will watch it for deadlines.
        </p>
        <Link
          href="/settings/imap"
          className="mt-2 inline-block rounded-xl bg-[#1F2D50] px-3 py-1 text-sm text-white"
        >
          Set up email monitoring
        </Link>
      </section>
    );
  }
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" aria-label="College inbox">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[#1F2D50]">College inbox</h2>
        <Link href="/email" className="text-sm text-[#1F2D50] underline">
          Open email center
        </Link>
      </div>
      <p className="mt-1 text-sm text-[#1F2D50]/70">
        {state.count} actionable email{state.count === 1 ? '' : 's'} in the last 24 hours
      </p>
      <ul className="mt-2 space-y-1">
        {state.latest.map((email) => (
          <li key={email.id} className="text-sm text-[#1F2D50]">
            • {email.summary ?? email.subject}
          </li>
        ))}
      </ul>
    </section>
  );
}

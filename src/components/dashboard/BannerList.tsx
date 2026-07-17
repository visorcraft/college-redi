'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import type { Banner } from '@/lib/banners';

export function BannerList({ banners, dismissed }: { banners: Banner[]; dismissed: string[] }) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());

  async function dismiss(id: string) {
    setGone((prev) => new Set(prev).add(id));
    await apiFetch('/api/settings', { method: 'PATCH', body: { ui: { setup_dismissed: [...dismissed, id] } } }).catch(() => {});
  }

  const visible = banners.filter((b) => !gone.has(b.id));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" role="region" aria-label="Setup reminders">
      {visible.map((b) => (
        <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#FFF4DD] px-4 py-2 text-sm text-[#1F2D50]">
          <span>{b.text}</span>
          <span className="flex shrink-0 items-center gap-3">
            <Link href={b.href} className="font-medium underline">Fix it</Link>
            <button type="button" aria-label={`Dismiss: ${b.text}`} onClick={() => dismiss(b.id)}
              className="text-[#1F2D50]/50 hover:text-[#1F2D50]">
              ✕
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

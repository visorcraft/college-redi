'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export function NotificationBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (pathname === '/login' || pathname === '/wizard') return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/notifications?unread_only=true&limit=1');
        if (res.ok && !cancelled) setUnread((await res.json()).unread_count ?? 0);
      } catch {
        // Bell stays quiet on errors.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  if (pathname === '/login' || pathname === '/wizard') return null;
  return (
    <Link
      href="/notifications"
      aria-label={`Notifications, ${unread} unread`}
      className="fixed right-6 top-4 z-40 rounded-full bg-white p-2 shadow-md"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#1F2D50"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-[#FFC24B] px-1.5 text-xs font-bold text-[#1F2D50]">
          {unread}
        </span>
      )}
    </Link>
  );
}

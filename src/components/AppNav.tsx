'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NotificationBell } from '@/components/ui/NotificationBell';

const LINKS = [
  ['Today', '/'],
  ['Search', '/search'],
  ['Tasks', '/tasks'],
  ['My Degree', '/degree'],
  ['College email', '/email'],
  ['Settings', '/settings'],
] as const;

export function AppNav() {
  if (usePathname() === '/wizard') return null;
  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST', redirect: 'manual' });
    window.location.assign('/login');
  };
  return (
    <header className="sticky top-0 z-30 border-b border-[#1F2D50]/10 bg-[#EAF3FB]/95 backdrop-blur">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2 sm:px-6"
      >
        <Link href="/" className="shrink-0 font-bold text-[#1F2D50]">
          Redi
        </Link>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {LINKS.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="shrink-0 rounded-xl px-3 py-2 text-sm font-medium text-[#1F2D50] hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
            >
              {label}
            </Link>
          ))}
        </div>
        <NotificationBell />
        <button
          type="button"
          onClick={() => void signOut()}
          className="shrink-0 rounded-xl border border-[#1F2D50]/30 px-3 py-2 text-sm font-medium text-[#1F2D50] hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
        >
          Sign out
        </button>
      </nav>
    </header>
  );
}

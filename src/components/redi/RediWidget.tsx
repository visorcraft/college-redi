'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { RediCloud } from './RediCloud';
import { ChatBubble } from './ChatBubble';
import { rediStatusLine } from './rediText';
import { deriveRediState } from './widgetState';

interface StatusPayload {
  aiConfigured: boolean;
  unreadCount: number;
  jobRunning: boolean;
}

const CELEBRATION_MS = 3_000;
const POLL_MS = 30_000;

export function RediWidget({
  aiConfigured,
  pollStatus = true,
}: {
  aiConfigured: boolean;
  pollStatus?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StatusPayload>({
    aiConfigured,
    unreadCount: 0,
    jobRunning: false,
  });
  const [chatBusy, setChatBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const celebrationTimer = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    if (!pollStatus) return;
    try {
      const response = await fetch('/api/redi/status', { cache: 'no-store' });
      if (response.ok) setStatus(await response.json() as StatusPayload);
    } catch {
      // Keep the last known status.
    }
  }, [pollStatus]);

  useEffect(() => {
    if (!pollStatus) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [pollStatus, refresh]);

  useEffect(() => {
    const onCelebrate = () => {
      if (celebrationTimer.current) {
        window.clearTimeout(celebrationTimer.current);
      }
      setCelebrating(true);
      celebrationTimer.current = window.setTimeout(
        () => setCelebrating(false),
        CELEBRATION_MS,
      );
    };
    window.addEventListener('redi:celebrate', onCelebrate);
    return () => {
      window.removeEventListener('redi:celebrate', onCelebrate);
      if (celebrationTimer.current) {
        window.clearTimeout(celebrationTimer.current);
      }
    };
  }, []);

  const input = { ...status, chatBusy, celebrating };
  const state = deriveRediState(input);
  const statusLine = rediStatusLine(input);

  if (pathname === '/login') return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="redi-widget"
        aria-label={statusLine}
        aria-expanded={open}
        aria-controls="redi-chat"
        title={statusLine}
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-6 right-6 z-50 rounded-full p-1 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[#FFC24B] motion-reduce:transition-none"
      >
        <span className="relative block" aria-hidden="true">
          <RediCloud state={state} size={64} />
          {state === 'alert' && status.unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#FFC24B] px-1 text-[11px] font-bold text-[#1F2D50]">
              {status.unreadCount > 99 ? '99+' : status.unreadCount}
            </span>
          )}
          {state === 'celebrating' && (
            <span className="absolute -left-2 -top-2 motion-reduce:hidden">
              🎉
            </span>
          )}
        </span>
      </button>
      <ChatBubble
        open={open}
        aiConfigured={status.aiConfigured}
        onClose={() => setOpen(false)}
        onBusyChange={setChatBusy}
        returnFocusRef={buttonRef}
      />
    </>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RediCloud } from './RediCloud';
import { ChatBubble } from './ChatBubble';
import { getWidgetState, getTooltip, SLEEPY_MESSAGE } from './widgetState';

export function RediWidget({ aiConfigured }: { aiConfigured: boolean }) {
  const state = getWidgetState({ aiConfigured });
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {open && (
        <ChatBubble onClose={() => setOpen(false)}>
          {state === 'sleepy' ? (
            <div className="flex flex-col gap-3">
              <p>{SLEEPY_MESSAGE}</p>
              <Link href="/settings/ai" onClick={() => setOpen(false)}
                className="rounded-xl bg-[#1F2D50] px-4 py-2 text-center text-sm font-medium text-white">
                Set up AI
              </Link>
            </div>
          ) : (
            // PHASE 6: replace this static note with the live chat UI
            // (conversation list, messages, streaming input — see spec §6.6).
            <p className="text-[#1F2D50]/70">
              Chat with Redi arrives in a later phase — this bubble will come alive then.
            </p>
          )}
        </ChatBubble>
      )}
      <div className="group relative">
        <span aria-hidden="true"
          className="pointer-events-none absolute bottom-full right-0 mb-2 hidden whitespace-nowrap rounded-xl bg-[#1F2D50] px-3 py-1 text-xs text-white group-hover:block">
          {getTooltip(state)}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close Redi' : 'Talk to Redi'} aria-expanded={open}
          className="rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-[#FFC24B]">
          <RediCloud mood={state === 'sleepy' ? 'sleepy' : 'idle'} size={64} />
        </button>
      </div>
    </div>
  );
}

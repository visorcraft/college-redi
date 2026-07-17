'use client';

import { useEffect } from 'react';
import { RediCloud } from './RediCloud';

export function ChatBubble({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-label="Redi chat"
      className="fixed bottom-24 right-6 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
      <div className="flex items-center justify-between bg-[#1F2D50] px-4 py-2 text-white">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <RediCloud mood="idle" size={24} /> Redi
        </span>
        <button type="button" onClick={onClose} aria-label="Close chat"
          className="rounded-lg px-2 py-1 text-white/80 hover:bg-white/10">
          ✕
        </button>
      </div>
      <div className="max-h-96 min-h-32 overflow-y-auto p-4 text-sm text-[#1F2D50]">{children}</div>
    </div>
  );
}

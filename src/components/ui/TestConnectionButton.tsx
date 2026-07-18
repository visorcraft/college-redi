'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { RediCloud } from '@/components/redi/RediCloud';

interface TestResult { ok: boolean; message?: string; warning?: string; [k: string]: unknown }

export function TestConnectionButton({ endpoint, label = 'Test connection', showRedi = false, beforeRun }: {
  endpoint: string; label?: string; showRedi?: boolean; beforeRun?: () => Promise<void>;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      await beforeRun?.();
      setResult(await apiFetch(endpoint, { method: 'POST' }));
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  const tone = !result ? '' : result.ok ? (result.warning ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900') : 'bg-red-50 text-red-900';
  const text = result ? (result.ok ? (result.warning ?? result.message ?? 'Connected — looks good!') : (result.message ?? 'Connection failed.')) : '';

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={run} disabled={running}
        className="self-start rounded-xl border border-[#1F2D50]/30 px-4 py-2 text-sm font-medium text-[#1F2D50] hover:bg-[#EAF3FB] disabled:opacity-50">
        {running ? 'Testing…' : label}
      </button>
      {result && (
        <div role="status" className={`flex items-center gap-3 rounded-xl p-3 text-sm ${tone}`}>
          {showRedi && <RediCloud mood={result.ok ? 'happy' : 'sad'} size={36} />}
          <span>{text}</span>
        </div>
      )}
    </div>
  );
}

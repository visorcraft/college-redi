'use client';

import { cloneElement, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface StepProps {
  onComplete?: (patch?: Record<string, unknown>) => Promise<void>;
  busy?: boolean;
  submitLabel?: string;
}

export function SettingsSection({ step, after }: { step: React.ReactElement<StepProps>; after?: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function onComplete(patch?: Record<string, unknown>) {
    setBusy(true);
    setStatus(null);
    try {
      if (patch) await apiFetch('/api/settings', { method: 'PATCH', body: patch });
      setStatus('Saved.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm">
      {cloneElement(step, { onComplete, busy, submitLabel: 'Save' })}
      {after}
      {status && <p role="status" className="text-sm text-[#1F2D50]">{status}</p>}
    </section>
  );
}

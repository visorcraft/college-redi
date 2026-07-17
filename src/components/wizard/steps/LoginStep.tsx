'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { PasswordField, PrimaryButton } from '@/components/ui/forms';

export function LoginStep({ hasPassword, onComplete, busy }: {
  hasPassword: boolean; onComplete: () => Promise<void>; busy: boolean;
}) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (hasPassword) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-[#1F2D50]">Your login</h1>
        <p className="text-sm text-[#1F2D50]">Your password is already set — you&apos;re good.</p>
        <PrimaryButton onClick={() => onComplete()} disabled={busy}>Continue</PrimaryButton>
      </div>
    );
  }

  async function save() {
    setError(null);
    if (pw1.length < 8) { setError('Use at least 8 characters.'); return; }
    if (pw1 !== pw2) { setError("Those don't match — try again."); return; }
    try {
      await apiFetch('/api/auth/setup', { method: 'POST', body: { password: pw1 } });
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">Your login</h1>
      <PasswordField label="Password" value={pw1} onChange={setPw1} hint="At least 8 characters. Stored as an Argon2id hash, never in plain text." />
      <PasswordField label="Confirm password" value={pw2} onChange={setPw2} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <PrimaryButton onClick={save} disabled={busy}>Create password</PrimaryButton>
    </div>
  );
}

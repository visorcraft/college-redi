'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { PasswordField, PrimaryButton } from '@/components/ui/forms';
import { useWizardSubmit, type WizardSubmitRef } from '../useWizardSubmit';

export function LoginStep({ hasPassword, onComplete, busy, submitRef }: {
  hasPassword: boolean; onComplete: () => Promise<void>; busy: boolean; submitRef?: WizardSubmitRef;
}) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasPassword) return;
    let cancelled = false;
    fetch('/api/auth/me')
      .then((response) => response.json())
      .then((me: { setupToken?: string }) => {
        if (!cancelled && me.setupToken) setSetupToken(me.setupToken);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [hasPassword]);

  const continueFn = () => { void onComplete(); };
  useWizardSubmit(submitRef, hasPassword ? continueFn : () => { void save(); });

  if (hasPassword) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-[#1F2D50]">Your login</h1>
        <p className="text-sm text-[#1F2D50]">Your password is already set - you&apos;re good.</p>
        {!submitRef && <PrimaryButton onClick={() => onComplete()} disabled={busy}>Continue</PrimaryButton>}
      </div>
    );
  }

  async function save() {
    setError(null);
    if (pw1.length < 8) { setError('Use at least 8 characters.'); return; }
    if (pw1 !== pw2) { setError("Those don't match - try again."); return; }
    try {
      await apiFetch('/api/auth/setup', {
        method: 'POST',
        body: { password: pw1, setupToken },
      });
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">Your login</h1>
      <input type="hidden" name="setup-token" value={setupToken} readOnly />
      <PasswordField label="Password" value={pw1} onChange={setPw1} hint="At least 8 characters." />
      <PasswordField label="Confirm password" value={pw2} onChange={setPw2} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!submitRef && <PrimaryButton onClick={save} disabled={busy}>Create password</PrimaryButton>}
    </div>
  );
}

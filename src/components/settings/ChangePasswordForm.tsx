'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { PasswordField, PrimaryButton } from '@/components/ui/forms';

export function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setStatus(null);
    if (next.length < 8) { setStatus({ ok: false, text: 'Use at least 8 characters.' }); return; }
    if (next !== confirm) { setStatus({ ok: false, text: "Those don't match — try again." }); return; }
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: { current_password: current, new_password: next },
      });
      setCurrent(''); setNext(''); setConfirm('');
      setStatus({ ok: true, text: 'Password updated. Other sessions were signed out.' });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PasswordField label="Current password" value={current} onChange={setCurrent} />
      <PasswordField label="New password" value={next} onChange={setNext} hint="At least 8 characters." />
      <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} />
      {status && (
        <p role="status" className={`text-sm ${status.ok ? 'text-emerald-800' : 'text-red-700'}`}>{status.text}</p>
      )}
      <PrimaryButton onClick={save}>Change password</PrimaryButton>
    </div>
  );
}

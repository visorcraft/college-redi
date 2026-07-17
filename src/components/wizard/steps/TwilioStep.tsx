'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { TextField, PasswordField, CheckboxField, PrimaryButton } from '@/components/ui/forms';
import { TestConnectionButton } from '@/components/ui/TestConnectionButton';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export function TwilioStep({ settings, onComplete = async () => {}, busy = false, submitLabel = 'Save & continue', variant = 'wizard' }: {
  settings: SettingsSnapshot; onComplete?: (patch?: Record<string, unknown>) => Promise<void>; busy?: boolean;
  submitLabel?: string; variant?: 'wizard' | 'settings';
}) {
  const twilio = settings.twilio ?? {};
  const [accountSid, setAccountSid] = useState(twilio.account_sid ?? '');
  const [authToken, setAuthToken] = useState('');
  const [fromNumber, setFromNumber] = useState(twilio.from_number ?? '');
  const [toNumber, setToNumber] = useState(twilio.to_number ?? '');
  const [enabled, setEnabled] = useState(twilio.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      if (authToken) await apiFetch('/api/settings/secret', { method: 'PUT', body: { name: 'twilio.auth_token', value: authToken } });
      await onComplete({ twilio: { ...twilio, account_sid: accountSid, from_number: fromNumber, to_number: toNumber, enabled } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">Text messages (Twilio)</h1>
      <p className="text-sm text-[#1F2D50]/70">
        Optional — skip this if email is enough. On a Twilio trial account, texts only go to verified numbers.
      </p>
      <TextField label="Account SID" value={accountSid} onChange={setAccountSid} placeholder="AC…" />
      <PasswordField label="Auth token" value={authToken} onChange={setAuthToken}
        hint="Stored encrypted; never shown again. Leave blank to keep the saved token." />
      <TextField label="Twilio from-number" value={fromNumber} onChange={setFromNumber} type="tel" placeholder="+15551234567" />
      <TextField label="Your mobile number" value={toNumber} onChange={setToNumber} type="tel" placeholder="+15557654321" />
      {variant === 'settings' && <CheckboxField label="SMS delivery enabled" checked={enabled} onChange={setEnabled} />}
      <TestConnectionButton endpoint="/api/settings/test/twilio" label="Send test SMS" showRedi />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <PrimaryButton onClick={save} disabled={busy}>{submitLabel}</PrimaryButton>
    </div>
  );
}

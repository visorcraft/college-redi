'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { PROVIDERS, providerById } from '@/lib/providers';
import { TextField, PasswordField, SelectField, CheckboxField, PrimaryButton } from '@/components/ui/forms';
import { TestConnectionButton } from '@/components/ui/TestConnectionButton';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export function SmtpStep({ settings, onComplete = async () => {}, busy = false, submitLabel = 'Save & continue', variant = 'wizard' }: {
  settings: SettingsSnapshot; onComplete?: (patch?: Record<string, unknown>) => Promise<void>; busy?: boolean;
  submitLabel?: string; variant?: 'wizard' | 'settings';
}) {
  const smtp = settings.smtp ?? {};
  const [providerId, setProviderId] = useState('other');
  const [host, setHost] = useState(smtp.host ?? '');
  const [port, setPort] = useState(String(smtp.port ?? 587));
  const [security, setSecurity] = useState(smtp.security ?? 'starttls');
  const [username, setUsername] = useState(smtp.username ?? '');
  const [password, setPassword] = useState('');
  const [fromAddress, setFromAddress] = useState(smtp.from_address ?? '');
  const [personalEmail, setPersonalEmail] = useState(smtp.personal_email ?? '');
  const [enabled, setEnabled] = useState(smtp.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  function pickProvider(id: string) {
    setProviderId(id);
    const p = providerById(id);
    if (p.smtp.host) setHost(p.smtp.host);
    setPort(String(p.smtp.port));
    setSecurity(p.smtp.security);
  }

  function pickSecurity(v: string) {
    setSecurity(v as 'tls' | 'starttls' | 'none');
    if (v === 'tls') setPort('465');
    if (v === 'starttls') setPort('587');
  }

  async function save() {
    setError(null);
    try {
      if (password) await apiFetch('/api/settings/secret', { method: 'PUT', body: { name: 'smtp.password', value: password } });
      await onComplete({
        smtp: { ...smtp, host, port: Number(port), security, username, from_address: fromAddress, personal_email: personalEmail, enabled },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">Personal email (SMTP)</h1>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Provider quick-picks">
        {PROVIDERS.map((p) => (
          <button key={p.id} type="button" onClick={() => pickProvider(p.id)}
            className={`rounded-xl px-3 py-1.5 text-sm ${p.id === providerId ? 'bg-[#1F2D50] text-white' : 'bg-[#EAF3FB] text-[#1F2D50]'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2"><TextField label="Host" value={host} onChange={setHost} placeholder="smtp.gmail.com" /></div>
        <TextField label="Port" value={port} onChange={setPort} type="number" />
      </div>
      <SelectField label="Security" value={security} onChange={pickSecurity}
        options={[
          { value: 'tls', label: 'TLS (port 465)' },
          { value: 'starttls', label: 'STARTTLS (port 587)' },
          { value: 'none', label: 'None (not recommended)' },
        ]} />
      <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" />
      <PasswordField label="Password / app password" value={password} onChange={setPassword}
        hint="Stored encrypted; never shown again. Leave blank to keep the saved password." />
      <TextField label="From identity" value={fromAddress} onChange={setFromAddress} placeholder="Redi <you@gmail.com>" />
      <TextField label="Your personal email" value={personalEmail} onChange={setPersonalEmail} type="email"
        hint="Summaries and reminders land here." />
      {variant === 'settings' && <CheckboxField label="Email delivery enabled" checked={enabled} onChange={setEnabled} />}
      <TestConnectionButton
        endpoint="/api/settings/test/smtp"
        label="Send test email"
        showRedi
        beforeRun={async () => {
          if (password) {
            await apiFetch('/api/settings/secret', {
              method: 'PUT',
              body: { name: 'smtp.password', value: password },
            });
          }
          await apiFetch('/api/settings', {
            method: 'PATCH',
            body: {
              smtp: {
                ...smtp,
                host,
                port: Number(port),
                security,
                username,
                from_address: fromAddress,
                personal_email: personalEmail,
                enabled,
              },
            },
          });
        }}
      />
      <p className="text-xs text-[#1F2D50]/60">The test sends a real &quot;hello from Redi ☁️&quot; message to your personal address.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <PrimaryButton onClick={save} disabled={busy}>{submitLabel}</PrimaryButton>
    </div>
  );
}

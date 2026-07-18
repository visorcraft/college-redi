'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { PROVIDERS, providerById } from '@/lib/providers';
import { TextField, PasswordField, CheckboxField, PrimaryButton } from '@/components/ui/forms';
import { TestConnectionButton } from '@/components/ui/TestConnectionButton';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export function ImapStep({ settings, onComplete = async () => {}, busy = false, submitLabel = 'Save & continue', variant = 'wizard' }: {
  settings: SettingsSnapshot; onComplete?: (patch?: Record<string, unknown>) => Promise<void>; busy?: boolean;
  submitLabel?: string; variant?: 'wizard' | 'settings';
}) {
  const imap = settings.imap ?? {};
  const [providerId, setProviderId] = useState('other');
  const [host, setHost] = useState(imap.host ?? '');
  const [port, setPort] = useState(String(imap.port ?? 993));
  const [tls, setTls] = useState(imap.tls ?? true);
  const [username, setUsername] = useState(imap.username ?? '');
  const [password, setPassword] = useState('');
  const [mailbox, setMailbox] = useState(imap.mailbox ?? 'INBOX');
  const [poll, setPoll] = useState(String(imap.poll_interval_minutes ?? 5));
  const [enabled, setEnabled] = useState(variant === 'wizard' ? true : (imap.enabled ?? false));
  const [error, setError] = useState<string | null>(null);
  const provider = providerById(providerId);

  function pickProvider(id: string) {
    setProviderId(id);
    const p = providerById(id);
    if (p.imap.host) setHost(p.imap.host);
    setPort(String(p.imap.port));
    setTls(true);
  }

  async function save() {
    setError(null);
    try {
      if (password) await apiFetch('/api/settings/secret', { method: 'PUT', body: { name: 'imap.password', value: password } });
      await onComplete({
        imap: { ...imap, host, port: Number(port), tls, username, mailbox, enabled, poll_interval_minutes: Number(poll) },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">College email (IMAP)</h1>
      {variant === 'settings' && imap.last_error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">Last poll failed: {imap.last_error}</p>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Provider quick-picks">
        {PROVIDERS.map((p) => (
          <button key={p.id} type="button" onClick={() => pickProvider(p.id)}
            className={`rounded-xl px-3 py-1.5 text-sm ${p.id === providerId ? 'bg-[#1F2D50] text-white' : 'bg-[#EAF3FB] text-[#1F2D50]'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="rounded-xl bg-[#EAF3FB] p-3 text-sm text-[#1F2D50]">
        {provider.passwordNote}{' '}
        {provider.helpUrl && (
          <a href={provider.helpUrl} target="_blank" rel="noreferrer" className="font-medium underline">
            Create an app password
          </a>
        )}
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2"><TextField label="Host" value={host} onChange={setHost} placeholder="imap.school.edu" /></div>
        <TextField label="Port" value={port} onChange={setPort} type="number" />
      </div>
      <CheckboxField label="Use TLS (recommended)" checked={tls} onChange={setTls} />
      <TextField label="Username" value={username} onChange={setUsername} placeholder="you@school.edu" autoComplete="username" />
      <PasswordField label="Password / app password" value={password} onChange={setPassword}
        hint="Stored encrypted; never shown again. Leave blank to keep the saved password." />
      {variant === 'settings' && (
        <>
          <TextField label="Mailbox" value={mailbox} onChange={setMailbox} hint="Almost always INBOX." />
          <TextField label="Poll interval (minutes, 1–60)" value={poll} onChange={setPoll} type="number" />
          <CheckboxField label="Monitoring enabled" checked={enabled} onChange={setEnabled} />
        </>
      )}
      <TestConnectionButton
        endpoint="/api/settings/test/imap"
        showRedi
        body={{
          host,
          port: Number(port),
          tls,
          username,
          mailbox,
          ...(password ? { password } : {}),
        }}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <PrimaryButton onClick={save} disabled={busy}>{submitLabel}</PrimaryButton>
    </div>
  );
}

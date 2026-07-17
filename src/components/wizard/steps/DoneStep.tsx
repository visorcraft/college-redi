'use client';

import Link from 'next/link';
import { PrimaryButton } from '@/components/ui/forms';
import type { SettingsSnapshot } from '@/lib/schemas/settings';
import type { SecretFlags } from '../WizardShell';

export function DoneStep({ settings, secretFlags, onFinish, busy }: {
  settings: SettingsSnapshot; secretFlags: SecretFlags; onFinish: () => Promise<void>; busy: boolean;
}) {
  const rows = [
    { id: 'ai', label: 'AI brain', ok: secretFlags.aiKey && Boolean(settings.ai?.model), href: '/settings/ai' },
    { id: 'imap', label: 'College email', ok: Boolean(settings.imap?.host) && secretFlags.imapPassword, href: '/settings/imap' },
    { id: 'smtp', label: 'Personal email', ok: Boolean(settings.smtp?.host) && secretFlags.smtpPassword, href: '/settings/smtp' },
    { id: 'twilio', label: 'Text messages', ok: Boolean(settings.twilio?.account_sid) && secretFlags.twilioToken, href: '/settings/twilio' },
    { id: 'degree', label: 'Your degree', ok: Boolean(settings.degree_profile?.program), href: '/degree' },
    { id: 'checklist', label: 'Starting checklist', ok: (settings.wizard_state?.pending_checklist?.length ?? 0) > 0, href: '/tasks' },
    { id: 'notifications', label: 'Notification style', ok: Boolean(settings.notification_prefs), href: '/settings/notifications' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">Done 🎉</h1>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-[#1F2D50]">
              <span aria-hidden="true" className={r.ok ? 'text-emerald-700' : 'text-[#1F2D50]/40'}>{r.ok ? '✓' : '—'}</span>{' '}
              {r.label}
              <span className="sr-only">{r.ok ? ' set up' : ' not set up'}</span>
            </span>
            {!r.ok && <Link href={r.href} className="font-medium text-[#1F2D50] underline">Finish later</Link>}
          </li>
        ))}
      </ul>
      <p className="text-sm text-[#1F2D50]/70">Anything marked &quot;not set up&quot; gets a gentle reminder banner on your dashboard — never a modal.</p>
      <PrimaryButton onClick={onFinish} disabled={busy}>Take me to my dashboard</PrimaryButton>
    </div>
  );
}

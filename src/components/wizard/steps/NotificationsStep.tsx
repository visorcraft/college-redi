'use client';

import { useState } from 'react';
import { TextField, PrimaryButton } from '@/components/ui/forms';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export function NotificationsStep({ settings, onComplete = async () => {}, busy = false, submitLabel = 'Save & continue' }: {
  settings: SettingsSnapshot; onComplete?: (patch?: Record<string, unknown>) => Promise<void>; busy?: boolean; submitLabel?: string;
}) {
  const prefs = settings.notification_prefs;
  const [mode, setMode] = useState<'urgent_digest' | 'immediate_all'>(
    prefs && prefs.digest_enabled === false ? 'immediate_all' : 'urgent_digest',
  );
  const [digestTime, setDigestTime] = useState(prefs?.digest_time ?? '08:00');
  const [quietStart, setQuietStart] = useState(settings.quiet_hours?.start ?? '22:00');
  const [quietEnd, setQuietEnd] = useState(settings.quiet_hours?.end ?? '08:00');
  const [timezone, setTimezone] = useState(
    settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
  );

  function save() {
    return onComplete({
      timezone,
      quiet_hours: { start: quietStart, end: quietEnd },
      notification_prefs: {
        urgent: ['in_app', 'email', 'sms'],
        normal: mode === 'immediate_all' ? ['in_app', 'email'] : ['in_app'],
        low: ['in_app'],
        digest_enabled: mode === 'urgent_digest',
        digest_time: digestTime,
      },
    });
  }

  const radio = (value: 'urgent_digest' | 'immediate_all', title: string, body: string) => (
    <label className={`flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 ${mode === value ? 'border-[#1F2D50] bg-[#EAF3FB]' : 'border-[#1F2D50]/20'}`}>
      <span className="flex items-center gap-2 text-sm font-semibold text-[#1F2D50]">
        <input type="radio" name="notif-mode" checked={mode === value} onChange={() => setMode(value)} className="accent-[#1F2D50]" />
        {title}
      </span>
      <span className="text-sm text-[#1F2D50]/70">{body}</span>
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">Notification style</h1>
      {radio('urgent_digest', 'Urgent now, the rest in a morning digest', 'Recommended. Deadlines and registration pings arrive immediately; FYI mail is summarized once a day.')}
      {radio('immediate_all', 'Send everything right away', 'Every summary and reminder lands as it happens.')}
      {mode === 'urgent_digest' && (
        <TextField label="Digest time" value={digestTime} onChange={setDigestTime} type="time" />
      )}
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Quiet hours start" value={quietStart} onChange={setQuietStart} type="time" />
        <TextField label="Quiet hours end" value={quietEnd} onChange={setQuietEnd} type="time" />
      </div>
      <p className="text-xs text-[#1F2D50]/60">During quiet hours I hold non-urgent messages. Urgent ones (like a registration window opening) still come through.</p>
      <TextField label="Timezone" value={timezone} onChange={setTimezone} hint="Auto-detected from your browser — edit if it looks wrong." />
      <PrimaryButton onClick={save} disabled={busy}>{submitLabel}</PrimaryButton>
    </div>
  );
}

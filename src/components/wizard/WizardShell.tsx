'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RediCloud } from '@/components/redi/RediCloud';
import { apiFetch } from '@/lib/api';
import { stepByN, advanceWizardState } from '@/lib/wizard';
import type { SettingsSnapshot, WizardState, PendingChecklistItem } from '@/lib/schemas/settings';
import type { WizardSubmitRef } from './useWizardSubmit';
import { WelcomeStep } from './steps/WelcomeStep';
import { LoginStep } from './steps/LoginStep';
import { AiStep } from './steps/AiStep';
import { ImapStep } from './steps/ImapStep';
import { SmtpStep } from './steps/SmtpStep';
import { TwilioStep } from './steps/TwilioStep';
import { DegreeStep } from './steps/DegreeStep';
import { ChecklistStep } from './steps/ChecklistStep';
import { NotificationsStep } from './steps/NotificationsStep';
import { DoneStep } from './steps/DoneStep';

export interface SecretFlags { aiKey: boolean; imapPassword: boolean; smtpPassword: boolean; twilioToken: boolean }

const DEFAULT_WIZARD_STATE: WizardState = { completed: false, skipped_steps: [], current_step: 1 };
const PRE_AUTH_STEP_KEY = 'redi_wizard_step';

export function WizardShell({ initialSettings, hasPassword, secretFlags }: {
  initialSettings: SettingsSnapshot; hasPassword: boolean; secretFlags: SecretFlags;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsSnapshot>(initialSettings);
  const wizardState = settings.wizard_state ?? DEFAULT_WIZARD_STATE;
  const [stepN, setStepN] = useState(() => Math.min(Math.max(wizardState.current_step ?? 1, 1), 10));
  const [busy, setBusy] = useState(false);
  const [raining, setRaining] = useState(false);
  const submitRef = useRef<(() => void) | null>(null);
  const step = stepByN(stepN);

  const onActionSave = () => {
    if (busy) return;
    submitRef.current?.();
  };

  const onCloudClick = () => {
    if (raining) return;
    setRaining(true);
    setTimeout(() => setRaining(false), 2000);
  };

  useEffect(() => {
    if (!hasPassword && stepN === 1 && localStorage.getItem(PRE_AUTH_STEP_KEY) === '2') {
      setStepN(2);
    }
  }, [hasPassword, stepN]);

  async function persist(patch: Record<string, unknown>, next: number, opts: { skippedId?: string; unskipId?: string } = {}) {
    setBusy(true);
    try {
      const nextWizard = advanceWizardState(wizardState, next, opts.skippedId, opts.unskipId);
      const updated = await apiFetch('/api/settings', { method: 'PATCH', body: { ...patch, wizard_state: nextWizard } });
      setSettings(updated);
      setStepN(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const onComplete = (patch?: Record<string, unknown>) => persist(patch ?? {}, stepN + 1, { unskipId: step.id });
  const onSkip = step.skippable ? () => persist({}, stepN + 1, { skippedId: step.id }) : undefined;
  const onBack = stepN > 1 && step.id !== 'done'
    ? stepN === 2 && !hasPassword
      ? () => {
          localStorage.removeItem(PRE_AUTH_STEP_KEY);
          setStepN(1);
        }
      : () => persist({}, stepN - 1)
    : undefined;

  async function onWelcomeComplete() {
    if (hasPassword) {
      await persist({}, 2, { unskipId: step.id });
      return;
    }
    localStorage.setItem(PRE_AUTH_STEP_KEY, '2');
    setStepN(2);
  }

  async function onLoginComplete() {
    await onComplete();
    localStorage.removeItem(PRE_AUTH_STEP_KEY);
  }

  async function onSaveChecklist(items: PendingChecklistItem[]) {
    setBusy(true);
    try {
      const nextWizard = { ...advanceWizardState(wizardState, stepN + 1, undefined, step.id), pending_checklist: items };
      const updated = await apiFetch('/api/settings', { method: 'PATCH', body: { wizard_state: nextWizard } });
      setSettings(updated);
      setStepN(stepN + 1);
    } finally {
      setBusy(false);
    }
  }

  async function onFinish() {
    setBusy(true);
    try {
      await apiFetch('/api/settings', { method: 'PATCH', body: { wizard_state: { ...wizardState, completed: true, current_step: 10 } } });
      router.push('/');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[37.8rem] flex-col items-center justify-center gap-6 p-6">
      <RediCloud
        mood={step.id === 'done' ? 'happy' : 'idle'}
        size={115}
        state={raining ? 'raining' : step.id === 'done' ? 'celebrating' : 'idle'}
        onClick={onCloudClick}
        disabled={raining}
      >
        {raining && (
          <span className="redi-rain-host" aria-hidden="true">
            {[15, 30, 45, 55, 65, 75, 40, 25, 60, 85].map((left, i) => (
              <span
                key={i}
                className="redi-rain-drop"
                style={{ left: `${left}%`, animationDelay: `${(i % 5) * 0.12}s` }}
              />
            ))}
          </span>
        )}
      </RediCloud>
      <p className="text-center text-lg leading-relaxed text-[#1F2D50]">
        {step.redi.split(/<br\s*\/?>/i).map((line, li, lines) => (
          <span key={li}>
            {line.split(/(?<=\.)\s+/).map((seg, i, arr) => (
              <span key={i}>{seg}{i < arr.length - 1 && <br />}</span>
            ))}
            {li < lines.length - 1 && <br />}
          </span>
        ))}
      </p>
      <div className="w-full rounded-2xl bg-white p-6 shadow-sm">
        <p className="mb-4 text-center text-sm text-[#1F2D50]/70">
          Step {stepN} of 10 - {step.title}
        </p>
        {step.id === 'welcome' && <WelcomeStep onComplete={onWelcomeComplete} busy={busy} submitRef={submitRef} />}
        {step.id === 'login' && <LoginStep hasPassword={hasPassword} onComplete={onLoginComplete} busy={busy} submitRef={submitRef} />}
        {step.id === 'ai' && <AiStep settings={settings} onComplete={onComplete} busy={busy} submitRef={submitRef} />}
        {step.id === 'imap' && <ImapStep settings={settings} onComplete={onComplete} busy={busy} submitRef={submitRef} />}
        {step.id === 'smtp' && <SmtpStep settings={settings} onComplete={onComplete} busy={busy} submitRef={submitRef} />}
        {step.id === 'twilio' && <TwilioStep settings={settings} onComplete={onComplete} busy={busy} submitRef={submitRef} />}
        {step.id === 'degree' && <DegreeStep settings={settings} onComplete={onComplete} busy={busy} submitRef={submitRef} />}
        {step.id === 'checklist' && <ChecklistStep onSave={onSaveChecklist} busy={busy} submitRef={submitRef} />}
        {step.id === 'notifications' && <NotificationsStep settings={settings} onComplete={onComplete} busy={busy} preferBrowserTimezone submitRef={submitRef} />}
        {step.id === 'done' && <DoneStep settings={settings} secretFlags={secretFlags} onFinish={onFinish} busy={busy} submitRef={submitRef} />}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={busy || !onBack}
            className="rounded-xl border border-[#1F2D50]/30 bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2D50] hover:bg-[#EAF3FB] disabled:opacity-40"
            style={{ flex: '1 1 25%' }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={onActionSave}
            disabled={busy}
            className="rounded-xl bg-[#1F2D50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2E416E] disabled:opacity-50"
            style={{ flex: '2 1 50%' }}
          >
            {busy ? 'One moment…' : 'Save & continue'}
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy || !onSkip}
            className="rounded-xl border border-[#1F2D50]/30 bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2D50] hover:bg-[#EAF3FB] disabled:opacity-40"
            style={{ flex: '1 1 25%' }}
          >
            Skip
          </button>
        </div>
      </div>
    </main>
  );
}

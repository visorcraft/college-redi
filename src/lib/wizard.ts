import type { WizardState } from './schemas/settings';

export interface WizardStepDef { n: number; id: string; title: string; skippable: boolean; redi: string }

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { n: 1, id: 'welcome', title: 'Welcome', skippable: false,
    redi: "Hi, I'm Redi ☁️ - I keep your degree on track. I plan your courses, watch registration windows, chase missing paperwork, and read your college email so you don't have to." },
  { n: 2, id: 'login', title: 'Your login', skippable: false,
    redi: 'First, a password. This is a private, one-person app - this keeps it that way.' },
  { n: 3, id: 'ai', title: 'AI brain', skippable: true,
    redi: 'This is what lets me think and talk.' },
  { n: 4, id: 'imap', title: 'College email', skippable: true,
    redi: 'I check this inbox every few minutes and pull out what matters. Read-only, always - I never write to your mailbox.' },
  { n: 5, id: 'smtp', title: 'Personal email', skippable: true,
    redi: 'Where should I send summaries and reminders? Your everyday email is perfect.' },
  { n: 6, id: 'twilio', title: 'Text messages', skippable: true,
    redi: 'Want texts for urgent stuff? Totally optional.' },
  { n: 7, id: 'degree', title: 'Your degree', skippable: true,
    redi: 'Tell me about your degree. You can import your audit with AI, or add everything by hand later.' },
  { n: 8, id: 'checklist', title: 'Starting checklist', skippable: true,
    redi: "Here's the usual freshman paperwork. Uncheck what doesn't apply and tweak the dates." },
  { n: 9, id: 'notifications', title: 'Notification style', skippable: true,
    redi: 'When should I buzz you? I hold non-urgent things during quiet hours.' },
  { n: 10, id: 'done', title: 'Done', skippable: false, redi: 'All set 🎉' },
];

export function stepByN(n: number): WizardStepDef {
  return WIZARD_STEPS.find((s) => s.n === n) ?? WIZARD_STEPS[0];
}

export function advanceWizardState(prev: WizardState, toStep: number, skippedId?: string, unskipId?: string): WizardState {
  const skipped = new Set(prev.skipped_steps ?? []);
  if (skippedId) skipped.add(skippedId);
  if (unskipId) skipped.delete(unskipId);
  return { ...prev, skipped_steps: [...skipped], current_step: toStep };
}

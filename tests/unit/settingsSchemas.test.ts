import { describe, it, expect } from 'vitest';
import {
  WizardStateSchema, NotificationPrefsSchema, EffortSchema, ChannelSchema,
  TaskCategorySchema, SettingsPatchSchema, SecretPutSchema, STANDARD_CHECKLIST,
} from '@/lib/schemas/settings';
import { PROVIDERS, providerById } from '@/lib/providers';
import { WIZARD_STEPS, stepByN, advanceWizardState } from '@/lib/wizard';

describe('settings schemas', () => {
  it('parses a minimal wizard_state', () => {
    const s = WizardStateSchema.parse({ completed: false, skipped_steps: [], current_step: 1 });
    expect(s.current_step).toBe(1);
  });

  it('parses wizard_state with a pending checklist (Phase 4 handoff)', () => {
    const s = WizardStateSchema.parse({
      completed: false, skipped_steps: ['twilio'], current_step: 9,
      pending_checklist: [{ title: 'Send your final high-school transcript', category: 'transcript', due_at: null }],
    });
    expect(s.pending_checklist).toHaveLength(1);
    expect(s.skipped_steps).toEqual(['twilio']);
  });

  it('rejects current_step outside 1..10', () => {
    expect(() => WizardStateSchema.parse({ completed: false, skipped_steps: [], current_step: 11 })).toThrow();
  });

  it('ships the spec §5.1 step-8 freshman checklist with §7.3 categories', () => {
    expect(STANDARD_CHECKLIST.map(i => i.title)).toEqual([
      'Send your final high-school transcript',
      'Submit immunization / vaccine records',
      'Accept financial aid / complete FAFSA',
      'Pay the housing deposit',
      'Register for orientation',
      'Meet your academic advisor',
    ]);
    for (const item of STANDARD_CHECKLIST) TaskCategorySchema.parse(item.category);
  });

  it('parses default notification prefs (spec §6.5.2 mapping)', () => {
    const p = NotificationPrefsSchema.parse({
      urgent: ['in_app', 'email', 'sms'], normal: ['in_app', 'email'], low: ['in_app'],
      digest_enabled: true, digest_time: '08:00',
    });
    expect(p.digest_time).toBe('08:00');
  });

  it('rejects invalid effort and channel values', () => {
    expect(() => EffortSchema.parse('extreme')).toThrow();
    expect(() => ChannelSchema.parse('pigeon')).toThrow();
  });

  it('accepts the patches the wizard/settings UI sends', () => {
    SettingsPatchSchema.parse({ timezone: 'America/Chicago', quiet_hours: { start: '22:00', end: '08:00' } });
    SettingsPatchSchema.parse({ wizard_state: { completed: true, skipped_steps: [], current_step: 10 } });
    SettingsPatchSchema.parse({ degree_profile: { institution: 'State U', program: 'B.S. CS', catalog_year: '2025' } });
    SettingsPatchSchema.parse({ ui: { setup_dismissed: ['skip:twilio'] } });
  });

  it('only allows the four UI-writable secret names', () => {
    SecretPutSchema.parse({ name: 'ai.api_key', value: 'sk-x' });
    expect(() => SecretPutSchema.parse({ name: 'login.password_hash', value: 'x' })).toThrow();
  });
});

describe('providers (Appendix B cheat sheet)', () => {
  it('prefills hosts/ports verbatim from spec Appendix B', () => {
    expect(providerById('gmail').imap).toEqual({ host: 'imap.gmail.com', port: 993 });
    expect(providerById('outlook').smtp).toEqual({ host: 'smtp.office365.com', port: 587, security: 'starttls' });
    expect(providerById('yahoo').imap.host).toBe('imap.mail.yahoo.com');
    expect(providerById('icloud').smtp).toEqual({ host: 'smtp.mail.me.com', port: 587, security: 'starttls' });
    expect(PROVIDERS).toHaveLength(5);
  });

  it('falls back to Other / school for unknown ids', () => {
    expect(providerById('hogwarts').id).toBe('other');
  });
});

describe('wizard constants', () => {
  it('has exactly the 10 spec §5.1 steps in order', () => {
    expect(WIZARD_STEPS.map(s => s.id)).toEqual([
      'welcome', 'login', 'ai', 'imap', 'smtp', 'twilio', 'degree', 'checklist', 'notifications', 'done',
    ]);
  });

  it('marks exactly steps 3-9 skippable (spec §5.1 table)', () => {
    expect(WIZARD_STEPS.filter(s => s.skippable).map(s => s.n)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(stepByN(2).skippable).toBe(false);
    expect(stepByN(10).skippable).toBe(false);
  });

  it('advanceWizardState records skips and clears them on completion', () => {
    const base = { completed: false, skipped_steps: [], current_step: 3 };
    const skipped = advanceWizardState(base, 4, 'ai');
    expect(skipped).toEqual({ completed: false, skipped_steps: ['ai'], current_step: 4 });
    const unskipped = advanceWizardState(skipped, 5, undefined, 'ai');
    expect(unskipped.skipped_steps).toEqual([]);
    expect(unskipped.current_step).toBe(5);
  });

  it('advanceWizardState preserves pending_checklist', () => {
    const prev = { completed: false, skipped_steps: [], current_step: 9, pending_checklist: [{ title: 'x', category: 'other' as const, due_at: null }] };
    expect(advanceWizardState(prev, 10).pending_checklist).toHaveLength(1);
  });
});

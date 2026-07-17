import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';
import { getSettings, updateSettings } from '@/server/settings';

let env: TestEnv;
beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
});
afterEach(() => env.cleanup());

describe('settings store', () => {
  it('creates the single row with spec §7.1 defaults on first read', async () => {
    const s = await getSettings();
    expect(s.timezone).toBe('UTC');
    expect(s.quiet_hours).toEqual({ start: '22:00', end: '08:00' });
    expect(s.notification_prefs.digest_time).toBe('08:00');
    expect(s.notification_prefs.channels.urgent).toEqual(['in_app', 'email', 'sms']);
    expect(s.ai).toMatchObject({ base_url: 'https://api.openai.com/v1', model: 'gpt-5.6-luna', effort: 'medium', daily_cap: 500 });
    expect(s.imap).toMatchObject({ port: 993, tls: true, mailbox: 'INBOX', poll_interval_minutes: 5, enabled: false });
    expect(s.smtp).toMatchObject({ port: 465, security: 'tls', enabled: false });
    expect(s.wizard_state).toMatchObject({ completed: false, skipped_steps: [], current_step: 1 });
  });

  it('deep-merges patches and preserves sibling keys across reads', async () => {
    const updated = await updateSettings({ ai: { model: 'custom-model' }, wizard_state: { completed: true } });
    expect(updated.ai.model).toBe('custom-model');
    expect(updated.ai.effort).toBe('medium');
    expect(updated.wizard_state.completed).toBe(true);
    expect(updated.wizard_state.current_step).toBe(1);
    const reread = await getSettings();
    expect(reread.ai.model).toBe('custom-model');
    expect(reread.wizard_state.completed).toBe(true);
  });

  it('rejects invalid values', async () => {
    await expect(updateSettings({ ai: { effort: 'extreme' as never } })).rejects.toThrow();
    await expect(updateSettings({ imap: { poll_interval_minutes: 0 } })).rejects.toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { getWidgetState, getTooltip, SLEEPY_MESSAGE } from '@/components/redi/widgetState';

describe('widgetState', () => {
  it('is sleepy when AI is not configured, idle otherwise', () => {
    expect(getWidgetState({ aiConfigured: false })).toBe('sleepy');
    expect(getWidgetState({ aiConfigured: true })).toBe('idle');
  });

  it('uses the spec §6.6 sleepy message verbatim', () => {
    expect(SLEEPY_MESSAGE).toBe('Redi can talk to you once you add your AI credentials and pick a model');
  });

  it('has a one-line tooltip per state (spec §6.7)', () => {
    expect(getTooltip('sleepy')).toBe('Redi is sleepy - add your AI key to wake him up');
    expect(getTooltip('idle')).toBe('Redi is here if you need him');
  });
});

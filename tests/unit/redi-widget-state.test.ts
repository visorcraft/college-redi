import { describe, it, expect } from 'vitest';
import { deriveRediState, type RediStatusInput } from '../../src/components/redi/widgetState';

const base: RediStatusInput = {
  aiConfigured: true,
  unreadCount: 0,
  chatBusy: false,
  jobRunning: false,
  celebrating: false,
};

describe('deriveRediState', () => {
  it('is sleepy whenever AI is not configured', () => {
    expect(deriveRediState({ ...base, aiConfigured: false })).toBe('sleepy');
    expect(deriveRediState({
      ...base,
      aiConfigured: false,
      unreadCount: 5,
      chatBusy: true,
    })).toBe('sleepy');
  });

  it('celebrating beats thinking and alert', () => {
    expect(deriveRediState({
      ...base,
      celebrating: true,
      unreadCount: 3,
      chatBusy: true,
    })).toBe('celebrating');
  });

  it('thinks while chat or a background job is busy', () => {
    expect(deriveRediState({ ...base, chatBusy: true })).toBe('thinking');
    expect(deriveRediState({ ...base, jobRunning: true })).toBe('thinking');
    expect(deriveRediState({
      ...base,
      chatBusy: true,
      unreadCount: 2,
    })).toBe('thinking');
  });

  it('alerts for unread notifications', () => {
    expect(deriveRediState({ ...base, unreadCount: 1 })).toBe('alert');
  });

  it('is idle otherwise', () => {
    expect(deriveRediState(base)).toBe('idle');
  });
});

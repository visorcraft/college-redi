import { describe, expect, it } from 'vitest';
import { initialNotificationTimezone } from '@/components/wizard/steps/NotificationsStep';

describe('initialNotificationTimezone', () => {
  it('prefers browser time in the wizard and stored time in settings', () => {
    expect(initialNotificationTimezone('UTC', true, 'America/Chicago'))
      .toBe('America/Chicago');
    expect(initialNotificationTimezone('America/New_York', false, 'America/Chicago'))
      .toBe('America/New_York');
    expect(initialNotificationTimezone('America/Denver', true, ''))
      .toBe('America/Denver');
  });
});

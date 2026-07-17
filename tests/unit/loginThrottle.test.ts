import { beforeEach, expect, it } from 'vitest';
import {
  _loginThrottleEntryCountForTests,
  _loginThrottleRowForTests,
  _resetLoginThrottleForTests,
  recordLoginFailure,
} from '../../src/server/loginThrottle';

beforeEach(_resetLoginThrottleForTests);

it('bounds incomplete per-client login failure counters', async () => {
  for (let index = 0; index < 10_100; index += 1) {
    await recordLoginFailure(`client-${index}`);
  }
  expect(_loginThrottleEntryCountForTests()).toBeLessThanOrEqual(10_000);
});

it('caps persistent lockout identities to fixed slots', () => {
  const rows = new Set(
    Array.from({ length: 10_100 }, (_, index) =>
      _loginThrottleRowForTests(`client-${index}`)),
  );
  expect(rows.size).toBeLessThanOrEqual(1024);
});

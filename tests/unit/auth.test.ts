import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';
import { hashPassword, verifyPassword } from '@/server/password';
import { createSessionToken, newCsrfToken, readSessionToken, SESSION_TTL_SECONDS } from '@/server/auth';

let env: TestEnv;
beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
});
afterEach(() => env.cleanup());

describe('password hashing (Argon2id)', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});

describe('session tokens (HMAC-signed, 14-day)', () => {
  it('creates tokens that read back valid', async () => {
    expect((await readSessionToken(await createSessionToken())).valid).toBe(true);
  });

  it('rejects tampered and malformed tokens', async () => {
    const token = await createSessionToken();
    const [payload] = token.split('.');
    expect((await readSessionToken(`${payload}.AAAA`)).valid).toBe(false);
    expect((await readSessionToken('garbage')).valid).toBe(false);
    expect((await readSessionToken(undefined)).valid).toBe(false);
  });

  it('rejects expired tokens', async () => {
    const now = Date.now();
    const token = await createSessionToken(now);
    expect((await readSessionToken(token, now + (SESSION_TTL_SECONDS + 60) * 1000)).valid).toBe(false);
  });
});

describe('csrf tokens', () => {
  it('generates unique 32-byte base64url tokens', () => {
    const a = newCsrfToken();
    const b = newCsrfToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url').length).toBe(32);
  });
});

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(), ensureBootstrapped: vi.fn(), getSecret: vi.fn(), setSecret: vi.fn(),
  argonVerify: vi.fn(), argonHash: vi.fn(),
  createSessionToken: vi.fn(), newCsrfToken: vi.fn(),
}));
vi.mock('@/server/bootstrap', () => ({ ensureBootstrapped: mocks.ensureBootstrapped }));
vi.mock('@/server/tools/call', () => ({ callTool: mocks.callTool }));
vi.mock('@/server/secrets', () => ({ getSecret: mocks.getSecret, setSecret: mocks.setSecret }));
vi.mock('argon2', () => ({ default: { verify: mocks.argonVerify, hash: mocks.argonHash } }));
vi.mock('@/server/auth', () => ({
  createSessionToken: mocks.createSessionToken,
  newCsrfToken: mocks.newCsrfToken,
  SESSION_COOKIE: 'redi_session',
  CSRF_COOKIE: 'redi_csrf',
  SESSION_TTL_SECONDS: 1209600,
}));

import { GET, PATCH } from '@/app/api/settings/route';
import { PUT } from '@/app/api/settings/secret/route';
import { POST as changePassword } from '@/app/api/auth/change-password/route';

const jsonReq = (body: unknown) =>
  new NextRequest('http://localhost/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callTool.mockResolvedValue({ timezone: 'UTC' });
  mocks.createSessionToken.mockResolvedValue('fresh-session');
  mocks.newCsrfToken.mockReturnValue('fresh-csrf');
});

describe('GET/PATCH /api/settings', () => {
  it('GET returns the current settings', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ timezone: 'UTC' });
  });

  it('PATCH validates and applies a settings patch', async () => {
    const res = await PATCH(jsonReq({ timezone: 'America/Chicago' }));
    expect(mocks.callTool).toHaveBeenCalledWith('update_settings', { timezone: 'America/Chicago' }, { actor: 'user' });
    expect(res.status).toBe(200);
  });

  it('PATCH rejects invalid patches with 400', async () => {
    const res = await PATCH(jsonReq({ quiet_hours: { start: '25:99', end: '08:00' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('bad_request');
    expect(mocks.callTool).not.toHaveBeenCalled();
  });
});

describe('PUT /api/settings/secret', () => {
  it('stores an allowed secret and never echoes the value', async () => {
    const res = await PUT(jsonReq({ name: 'imap.password', value: 'hunter2' }));
    expect(mocks.callTool).toHaveBeenCalledWith(
      'set_secret',
      { name: 'imap.password', value: 'hunter2' },
      { actor: 'user' },
    );
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects non-UI secret names (e.g. login.password_hash)', async () => {
    const res = await PUT(jsonReq({ name: 'login.password_hash', value: 'x' }));
    expect(res.status).toBe(400);
    expect(mocks.callTool).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/change-password', () => {
  it('rejects a wrong current password with 403', async () => {
    mocks.getSecret.mockResolvedValue('existing-hash');
    mocks.argonVerify.mockResolvedValue(false);
    const res = await changePassword(jsonReq({ current_password: 'wrong', new_password: 'new-password-123' }));
    expect(res.status).toBe(403);
    expect(mocks.setSecret).not.toHaveBeenCalled();
  });

  it('hashes and stores the new password when the current one verifies', async () => {
    mocks.getSecret.mockResolvedValue('existing-hash');
    mocks.argonVerify.mockResolvedValue(true);
    mocks.argonHash.mockResolvedValue('new-hash');
    const res = await changePassword(jsonReq({ current_password: 'old-password', new_password: 'new-password-123' }));
    expect(mocks.argonHash).toHaveBeenCalledWith('new-password-123');
    expect(mocks.setSecret).toHaveBeenCalledWith('login.password_hash', 'new-hash');
    expect(await res.json()).toEqual({ ok: true, other_sessions_signed_out: true });
    expect(res.cookies.get('redi_session')?.value).toBe('fresh-session');
    expect(res.cookies.get('redi_csrf')?.value).toBe('fresh-csrf');
  });

  it('rejects short new passwords with 400', async () => {
    const res = await changePassword(jsonReq({ current_password: 'x', new_password: 'short' }));
    expect(res.status).toBe(400);
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureBootstrapped: vi.fn(),
  getLoginLockState: vi.fn(),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
  verifyPassword: vi.fn(),
  getSecret: vi.fn(),
  createSessionToken: vi.fn(),
  newCsrfToken: vi.fn(),
}));

vi.mock('@/server/bootstrap', () => ({
  ensureBootstrapped: mocks.ensureBootstrapped,
}));
vi.mock('@/server/loginThrottle', () => ({
  getLoginLockState: mocks.getLoginLockState,
  recordLoginFailure: mocks.recordLoginFailure,
  recordLoginSuccess: mocks.recordLoginSuccess,
}));
vi.mock('@/server/password', () => ({ verifyPassword: mocks.verifyPassword }));
vi.mock('@/server/secrets', () => ({ getSecret: mocks.getSecret }));
vi.mock('@/server/auth', () => ({
  createSessionToken: mocks.createSessionToken,
  newCsrfToken: mocks.newCsrfToken,
  SESSION_COOKIE: 'redi_session',
  CSRF_COOKIE: 'redi_csrf',
  SESSION_TTL_SECONDS: 1209600,
}));
vi.mock('@/server/security', () => ({
  clientKey: () => 'direct',
  isSecureRequest: () => false,
}));

import { POST } from '@/app/api/auth/login/route';

const request = () => new NextRequest('http://localhost/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'password' }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLoginLockState.mockResolvedValue({
    locked: false,
    retryAfterSeconds: 0,
  });
  mocks.getSecret.mockResolvedValue('password-hash');
  mocks.createSessionToken.mockResolvedValue('session');
  mocks.newCsrfToken.mockReturnValue('csrf');
});

describe('POST /api/auth/login', () => {
  it('rejects a locked client before loading or verifying the password hash', async () => {
    mocks.getLoginLockState.mockResolvedValue({
      locked: true,
      retryAfterSeconds: 120,
    });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('120');
    expect(mocks.getSecret).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it('locks on the threshold failure', async () => {
    mocks.getLoginLockState
      .mockResolvedValueOnce({ locked: false, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ locked: true, retryAfterSeconds: 300 });
    mocks.verifyPassword.mockResolvedValue(false);
    const response = await POST(request());
    expect(mocks.recordLoginFailure).toHaveBeenCalledWith('direct');
    expect(response.status).toBe(429);
  });
});

import { NextResponse, type NextRequest } from 'next/server';
import { LoginBodySchema } from '@/lib/schemas/auth';
import { createSessionToken, CSRF_COOKIE, newCsrfToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/server/auth';
import { ensureBootstrapped } from '@/server/bootstrap';
import { jsonError } from '@/server/http';
import { clientKey, isSecureRequest } from '@/server/security';
import { getLoginLockState, recordLoginFailure, recordLoginSuccess } from '@/server/loginThrottle';
import { verifyPassword } from '@/server/password';
import { getSecret } from '@/server/secrets';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await ensureBootstrapped();
  const key = clientKey(req);
  const body = LoginBodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError('invalid_body', 'Password is required.', 400);
  const lock = key
    ? await getLoginLockState(key)
    : { locked: false, retryAfterSeconds: 0 };
  if (lock.locked) {
    return jsonError('login_locked', 'Too many failed attempts. Try again in a few minutes.', 429, {
      'Retry-After': String(lock.retryAfterSeconds),
    });
  }
  const hash = await getSecret('login.password_hash');
  if (hash === null) return jsonError('setup_required', 'No password set yet. Create one first.', 403);
  const valid = await verifyPassword(hash, body.data.password);
  if (valid) {
    if (key) await recordLoginSuccess(key);
  } else {
    if (key) await recordLoginFailure(key);
    const updatedLock = key
      ? await getLoginLockState(key)
      : { locked: false, retryAfterSeconds: 0 };
    if (updatedLock.locked) {
      return jsonError('login_locked', 'Too many failed attempts. Try again in a few minutes.', 429, {
        'Retry-After': String(updatedLock.retryAfterSeconds),
      });
    }
    return jsonError('invalid_credentials', 'Wrong password.', 401);
  }
  const res = NextResponse.json({ ok: true });
  const secure = isSecureRequest(req);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_TTL_SECONDS });
  res.cookies.set(CSRF_COOKIE, newCsrfToken(), { sameSite: 'lax', secure, path: '/', maxAge: SESSION_TTL_SECONDS });
  return res;
}

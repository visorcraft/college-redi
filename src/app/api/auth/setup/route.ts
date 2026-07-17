import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { SetupBodySchema } from '@/lib/schemas/auth';
import { createSessionToken, CSRF_COOKIE, newCsrfToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/server/auth';
import { ensureBootstrapped } from '@/server/bootstrap';
import { getConfig } from '@/server/config';
import { jsonError } from '@/server/http';
import { hashPassword } from '@/server/password';
import { getSecret, setSecretIfAbsent } from '@/server/secrets';
import { isSecureRequest } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await ensureBootstrapped();
  if ((await getSecret('login.password_hash')) !== null) {
    return jsonError('setup_closed', 'A password is already set. Sign in instead.', 403);
  }
  const body = SetupBodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return jsonError('invalid_body', body.error.issues[0]?.message ?? 'Invalid request body.', 400);
  }
  const expected = getConfig().REDI_SETUP_TOKEN;
  const supplied = body.data.setupToken;
  if (!expected || !supplied || !sameSecret(expected, supplied)) {
    return jsonError(
      'invalid_setup_token',
      'Use REDI_SETUP_TOKEN from DATA_DIR/.env to claim this installation.',
      403,
    );
  }
  if (!await setSecretIfAbsent(
    'login.password_hash',
    await hashPassword(body.data.password),
  )) {
    return jsonError('setup_closed', 'A password is already set. Sign in instead.', 403);
  }
  const res = NextResponse.json({ ok: true });
  const secure = isSecureRequest(req);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_TTL_SECONDS });
  res.cookies.set(CSRF_COOKIE, newCsrfToken(), { sameSite: 'lax', secure, path: '/', maxAge: SESSION_TTL_SECONDS });
  return res;
}

function sameSecret(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

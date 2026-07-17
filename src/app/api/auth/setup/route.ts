import { NextResponse, type NextRequest } from 'next/server';
import { SetupBodySchema } from '@/lib/schemas/auth';
import { createSessionToken, CSRF_COOKIE, newCsrfToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/server/auth';
import { ensureBootstrapped } from '@/server/bootstrap';
import { jsonError } from '@/server/http';
import { hashPassword } from '@/server/password';
import { getSecret, setSecret } from '@/server/secrets';

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
  await setSecret('login.password_hash', await hashPassword(body.data.password));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS });
  res.cookies.set(CSRF_COOKIE, newCsrfToken(), { sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS });
  return res;
}

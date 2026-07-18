import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import argon2 from 'argon2';
import {
  createSessionToken,
  CSRF_COOKIE,
  newCsrfToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from '@/server/auth';
import { isSecureRequest } from '@/server/security';
import { getSecret, setSecret } from '@/server/secrets';

const BodySchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, 'Use at least 8 characters.').max(200),
});

export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Current password and a new password (8+ characters) are required.' } },
      { status: 400 },
    );
  }
  const hash = await getSecret('login.password_hash');
  if (!hash) {
    return NextResponse.json(
      { error: { code: 'no_password', message: 'No password is set yet - finish the wizard first.' } },
      { status: 400 },
    );
  }
  const ok = await argon2.verify(hash, parsed.data.current_password).catch(() => false);
  if (!ok) {
    return NextResponse.json(
      { error: { code: 'wrong_password', message: 'That current password is not correct.' } },
      { status: 403 },
    );
  }
  await setSecret('login.password_hash', await argon2.hash(parsed.data.new_password));
  const res = NextResponse.json({ ok: true, other_sessions_signed_out: true });
  const secure = isSecureRequest(req);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  res.cookies.set(CSRF_COOKIE, newCsrfToken(), {
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}

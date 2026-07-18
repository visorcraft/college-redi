import { NextResponse, type NextRequest } from 'next/server';
import { CSRF_COOKIE, revokeAllSessions, SESSION_COOKIE } from '@/server/auth';
import { isSecureRequest } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await revokeAllSessions();
  const res = new NextResponse(null, { status: 204 });
  const secure = isSecureRequest(req);
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0 });
  res.cookies.set(CSRF_COOKIE, '', { sameSite: 'lax', secure, path: '/', maxAge: 0 });
  return res;
}

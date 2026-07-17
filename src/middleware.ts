import { NextResponse, type NextRequest } from 'next/server';
import { createSessionToken, CSRF_COOKIE, readSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from './server/auth';

const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/me', '/api/auth/login', '/api/auth/setup', '/api/cron/tick']);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/mcp')) return NextResponse.next(); // Phase 7: own Bearer auth
  if (PUBLIC_API_PATHS.has(pathname)) return NextResponse.next();

  const { valid } = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith('/api/');

  if (!valid) {
    if (pathname === '/login') return NextResponse.next();
    if (isApi) {
      return NextResponse.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // CSRF double-submit on mutating API routes (spec §11.1); auth routes are exempt.
  if (isApi && !pathname.startsWith('/api/auth/') && MUTATING.has(req.method)) {
    const cookie = req.cookies.get(CSRF_COOKIE)?.value;
    const header = req.headers.get('x-csrf-token');
    if (!cookie || !header || cookie !== header) {
      return NextResponse.json({ error: { code: 'csrf_mismatch', message: 'Missing or invalid CSRF token.' } }, { status: 403 });
    }
  }

  const res = NextResponse.next();
  // Rolling 14-day session: re-issue on every authenticated request.
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

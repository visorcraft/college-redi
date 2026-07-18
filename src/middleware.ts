import { NextResponse, type NextRequest } from 'next/server';
import { readSessionToken, refreshSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from './server/auth';
import {
  applySecurityHeaders,
  contentSecurityPolicy,
  csrfFailure,
  ensureCsrfCookie,
  isExpensiveApiPath,
  isSecureRequest,
  requestRateLimitExceeded,
  rateLimitResponse,
  RATE_LIMITS,
} from './server/security';

const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/me', '/api/auth/login', '/api/auth/setup', '/api/cron/tick']);

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set('x-nonce', nonce);
  forwardedHeaders.set('x-redi-secure', String(isSecureRequest(req)));
  forwardedHeaders.set('Content-Security-Policy', contentSecurityPolicy(nonce));
  forwardedHeaders.set('x-pathname', pathname);
  const next = () => NextResponse.next({
    request: { headers: forwardedHeaders },
  });
  const secure = (response: NextResponse) =>
    ensureCsrfCookie(applySecurityHeaders(response, req, nonce), req);

  if (
    pathname === '/api/auth/login'
    && requestRateLimitExceeded(
      req,
      'login',
      RATE_LIMITS.login.limit,
      RATE_LIMITS.login.windowMs,
    )
  ) return secure(rateLimitResponse());
  if (
    pathname === '/api/cron/tick'
    && requestRateLimitExceeded(
      req,
      'cron',
      RATE_LIMITS.cron.limit,
      RATE_LIMITS.cron.windowMs,
    )
  ) return secure(rateLimitResponse());
  if (
    pathname.startsWith('/mcp')
    && requestRateLimitExceeded(
      req,
      'mcp',
      RATE_LIMITS.mcp.limit,
      RATE_LIMITS.mcp.windowMs,
    )
  ) return secure(rateLimitResponse());
  if (
    req.method === 'POST'
    && isExpensiveApiPath(pathname)
    && requestRateLimitExceeded(
      req,
      'expensive',
      RATE_LIMITS.expensive.limit,
      RATE_LIMITS.expensive.windowMs,
    )
  ) return secure(rateLimitResponse());
  const csrf = csrfFailure(req);
  if (csrf) return secure(csrf);

  if (pathname.startsWith('/mcp')) return secure(next());
  if (PUBLIC_API_PATHS.has(pathname)) return secure(next());

  const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith('/api/');

  if (!session.valid) {
    if (pathname === '/' || pathname === '/login' || pathname === '/wizard') {
      return secure(next());
    }
    if (isApi) {
      return secure(NextResponse.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, { status: 401 }));
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return secure(NextResponse.redirect(url));
  }

  if (pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return secure(NextResponse.redirect(url));
  }

  const res = next();
  // Rolling 14-day session: re-issue on every authenticated request.
  res.cookies.set(SESSION_COOKIE, await refreshSessionToken(session.passwordVersion), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure: isSecureRequest(req),
  });
  return secure(res);
}

export const config = {
  runtime: 'nodejs',
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|redi-cloud.svg|redi-cloud.lottie.json).*)',
  ],
};

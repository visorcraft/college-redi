import { NextResponse, type NextRequest } from 'next/server';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT = [
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/setup$/,
  /^\/api\/auth\/logout$/,
  /^\/api\/cron\/tick$/,
  /^\/api\/health$/,
];

export function applySecurityHeaders(
  response: NextResponse,
  request: NextRequest,
  nonce?: string,
): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  response.headers.set(
    'Content-Security-Policy',
    contentSecurityPolicy(nonce),
  );
  if (request.headers.get('x-forwarded-proto') === 'https') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }
  return response;
}

export function contentSecurityPolicy(nonce?: string): string {
  return `default-src 'self'; script-src 'self'${
    nonce ? ` 'nonce-${nonce}'` : ''
  }; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
}

export function csrfFailure(request: NextRequest): NextResponse | null {
  if (!MUTATING.has(request.method)) return null;
  if (!request.nextUrl.pathname.startsWith('/api/')) return null;
  if (CSRF_EXEMPT.some((pattern) =>
    pattern.test(request.nextUrl.pathname))) return null;
  const cookie = request.cookies.get('redi_csrf')?.value;
  const header = request.headers.get('x-csrf-token');
  if (cookie && header && cookie === header) return null;
  return NextResponse.json(
    {
      error: {
        code: 'csrf',
        message: 'CSRF token missing or invalid',
      },
    },
    { status: 403 },
  );
}

export function ensureCsrfCookie(
  response: NextResponse,
  request: NextRequest,
): NextResponse {
  if (!request.cookies.get('redi_csrf')?.value) {
    response.cookies.set('redi_csrf', crypto.randomUUID(), {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      secure: request.headers.get('x-forwarded-proto') === 'https',
    });
  }
  return response;
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimitExceeded(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

export function rateLimitResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'rate_limited',
        message: 'Too many requests — slow down.',
      },
    },
    { status: 429 },
  );
}

export function clientIp(request: NextRequest): string {
  return (request.headers.get('x-forwarded-for') ?? '')
    .split(',')[0]?.trim() || 'local';
}

export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 5 * 60_000 },
  cron: { limit: 12, windowMs: 60_000 },
  mcp: { limit: 240, windowMs: 60_000 },
} as const;

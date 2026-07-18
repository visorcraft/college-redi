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
  if (isSecureRequest(request)) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }
  return response;
}

export function contentSecurityPolicy(nonce?: string): string {
  const development = process.env.NODE_ENV === 'development';
  return `default-src 'self'; script-src 'self'${
    nonce ? ` 'nonce-${nonce}'` : ''
  }${development ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${
    development ? ' ws: wss:' : ''
  }; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
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
      secure: isSecureRequest(request),
    });
  }
  return response;
}

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

export function rateLimitExceeded(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [candidate, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(candidate);
      }
      while (buckets.size >= MAX_BUCKETS) {
        buckets.delete(buckets.keys().next().value as string);
      }
    }
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
        message: 'Too many requests - slow down.',
      },
    },
    { status: 429 },
  );
}

export function _rateLimitBucketCountForTests(): number {
  return buckets.size;
}

export function clientIp(
  request: NextRequest,
  trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0),
): string | null {
  const direct = (request as NextRequest & { ip?: string }).ip?.trim();
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 1) {
    return direct || null;
  }
  const chain = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return chain[Math.max(0, chain.length - trustedProxyHops)] ?? direct ?? null;
}

export function clientKey(request: NextRequest): string | null {
  const ip = clientIp(request);
  return ip ? `ip:${ip}` : 'direct';
}

export function requestRateLimitExceeded(
  request: NextRequest,
  scope: string,
  limit: number,
  windowMs: number,
): boolean {
  const ip = clientIp(request);
  const key = ip ? `ip:${ip}` : clientKey(request) ?? 'unattributed';
  if (rateLimitExceeded(`${scope}:${key}`, limit, windowMs)) return true;
  return ip === null
    && rateLimitExceeded(`${scope}:unattributed-global`, limit * 10, windowMs);
}

export function isSecureRequest(request: NextRequest): boolean {
  if (request.nextUrl.protocol === 'https:') return true;
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 1) return false;
  return (request.headers.get('x-forwarded-proto') ?? '')
    .split(',')
    .at(-1)
    ?.trim()
    .toLowerCase() === 'https';
}

export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 5 * 60_000 },
  cron: { limit: 12, windowMs: 60_000 },
  mcp: { limit: 240, windowMs: 60_000 },
} as const;

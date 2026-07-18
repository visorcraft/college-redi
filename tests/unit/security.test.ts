import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  applySecurityHeaders,
  _rateLimitBucketCountForTests,
  clientKey,
  clientIp,
  csrfFailure,
  ensureCsrfCookie,
  isSecureRequest,
  rateLimitExceeded,
  requestRateLimitExceeded,
} from '../../src/server/security';
import middleware from '../../src/middleware';

function req(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
  },
) {
  const request = new NextRequest(url, {
    method: init?.method ?? 'GET',
    headers: init?.headers,
  });
  for (const [key, value] of Object.entries(init?.cookies ?? {})) {
    request.cookies.set(key, value);
  }
  return request;
}

describe('security headers', () => {
  it('sets browser defenses and HSTS only behind TLS', () => {
    const plain = applySecurityHeaders(
      NextResponse.next(),
      req('http://localhost/'),
    );
    expect(plain.headers.get('content-security-policy'))
      .toContain("default-src 'self'");
    expect(plain.headers.get('content-security-policy'))
      .toContain("frame-ancestors 'none'");
    const nonce = applySecurityHeaders(
      NextResponse.next(),
      req('http://localhost/'),
      'test-nonce',
    );
    expect(nonce.headers.get('content-security-policy'))
      .toContain("'nonce-test-nonce'");
    expect(plain.headers.get('x-content-type-options')).toBe('nosniff');
    expect(plain.headers.get('x-frame-options')).toBe('DENY');
    expect(plain.headers.get('referrer-policy')).toBe('same-origin');
    expect(plain.headers.get('permissions-policy')).toContain('camera=()');
    expect(plain.headers.get('strict-transport-security')).toBeNull();

    const tls = applySecurityHeaders(NextResponse.next(), req('https://localhost/'));
    expect(tls.headers.get('strict-transport-security'))
      .toContain('max-age=31536000');
  });

  it('trusts forwarded TLS only when a proxy is configured', () => {
    const forwarded = req('http://localhost/', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    const previous = process.env.TRUST_PROXY_HOPS;
    try {
      process.env.TRUST_PROXY_HOPS = '0';
      expect(isSecureRequest(forwarded)).toBe(false);
      process.env.TRUST_PROXY_HOPS = '1';
      expect(isSecureRequest(forwarded)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = previous;
    }
  });

  it('allows Next HMR evaluation and sockets only in development', async () => {
    try {
      vi.stubEnv('NODE_ENV', 'development');
      const development = (await import('../../src/server/security'))
        .contentSecurityPolicy();
      expect(development).toContain("'unsafe-eval'");
      expect(development).toContain("connect-src 'self' ws: wss:");
      vi.stubEnv('NODE_ENV', 'production');
      const production = (await import('../../src/server/security'))
        .contentSecurityPolicy();
      expect(production).not.toContain("'unsafe-eval'");
      expect(production).not.toContain('ws:');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('CSRF double-submit', () => {
  it('rejects missing or mismatched tokens and allows a match', () => {
    expect(csrfFailure(req('http://localhost/api/tasks', {
      method: 'POST',
    }))?.status).toBe(403);
    expect(csrfFailure(req('http://localhost/api/tasks', {
      method: 'POST',
      headers: { 'x-csrf-token': 'a' },
      cookies: { redi_csrf: 'b' },
    }))?.status).toBe(403);
    expect(csrfFailure(req('http://localhost/api/tasks', {
      method: 'DELETE',
      headers: { 'x-csrf-token': 'a' },
      cookies: { redi_csrf: 'a' },
    }))).toBeNull();
  });

  it('exempts safe requests and public machine endpoints', () => {
    expect(csrfFailure(req('http://localhost/api/tasks'))).toBeNull();
    expect(csrfFailure(req('http://localhost/api/auth/login', {
      method: 'POST',
    }))).toBeNull();
    expect(csrfFailure(req('http://localhost/api/auth/setup', {
      method: 'POST',
    }))).toBeNull();
    expect(csrfFailure(req('http://localhost/api/auth/logout', {
      method: 'POST',
    }))).toBeNull();
    expect(csrfFailure(req('http://localhost/api/cron/tick', {
      method: 'POST',
    }))).toBeNull();
    expect(csrfFailure(req('http://localhost/api/health', {
      method: 'POST',
    }))).toBeNull();
  });

  it('issues a CSRF cookie only when none is present', () => {
    expect(ensureCsrfCookie(
      NextResponse.next(),
      req('http://localhost/'),
    ).cookies.get('redi_csrf')?.value).toBeTruthy();
    expect(ensureCsrfCookie(
      NextResponse.next(),
      req('http://localhost/', {
        cookies: { redi_csrf: 'keep-me' },
      }),
    ).cookies.get('redi_csrf')).toBeUndefined();
  });
});

describe('rate limiter', () => {
  it('cheaply rejects excess login requests before the route runs', async () => {
    const previous = process.env.TRUST_PROXY_HOPS;
    process.env.TRUST_PROXY_HOPS = '1';
    try {
      const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
      for (let i = 0; i < 10; i += 1) {
        const response = await middleware(req(
          'http://localhost/api/auth/login',
          { method: 'POST', headers: { 'x-forwarded-for': ip } },
        ));
        expect(response.status).toBe(200);
      }
      const blocked = await middleware(req(
        'http://localhost/api/auth/login',
        { method: 'POST', headers: { 'x-forwarded-for': ip } },
      ));
      expect(blocked.status).toBe(429);
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = previous;
    }
  });

  it('allows the limit, rejects excess, then resets', () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimitExceeded(key, 3, 1_000)).toBe(false);
    }
    expect(rateLimitExceeded(key, 3, 1_000)).toBe(true);
    expect(rateLimitExceeded(key, 3, 1_000, Date.now() + 2_000))
      .toBe(false);
  });

  it('bounds attacker-controlled client buckets', () => {
    for (let i = 0; i < 10_100; i += 1) {
      rateLimitExceeded(`attacker:${i}`, 1, 60_000);
    }
    expect(_rateLimitBucketCountForTests()).toBeLessThanOrEqual(10_000);
  });

  it('uses only the configured trusted proxy depth', () => {
    expect(clientIp(req('http://localhost/', {
      headers: { 'x-forwarded-for': 'spoofed, 1.2.3.4, 10.0.0.1' },
    }), 2)).toBe('1.2.3.4');
    expect(clientIp(req('http://localhost/', {
      headers: { 'x-forwarded-for': 'spoofed' },
    }))).toBeNull();
    expect(clientIp(req('http://localhost/'))).toBeNull();
  });

  it('uses one bounded direct key when no trusted address exists', () => {
    const csrf = `csrf-${crypto.randomUUID()}`;
    const direct = req('http://localhost/api/auth/login', {
      cookies: { redi_csrf: csrf },
    });
    expect(clientKey(direct)).toBe('direct');
    const scope = `direct-${crypto.randomUUID()}`;
    for (let i = 0; i < 10; i += 1) {
      const rotating = req('http://localhost/api/auth/login', {
        cookies: { redi_csrf: `csrf-${crypto.randomUUID()}` },
      });
      expect(requestRateLimitExceeded(rotating, scope, 10, 60_000))
        .toBe(false);
    }
    expect(requestRateLimitExceeded(direct, scope, 10, 60_000)).toBe(true);
  });
});

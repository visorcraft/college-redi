import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  applySecurityHeaders,
  clientIp,
  csrfFailure,
  ensureCsrfCookie,
  rateLimitExceeded,
} from '../../src/server/security';

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

    const tls = applySecurityHeaders(
      NextResponse.next(),
      req('http://localhost/', {
        headers: { 'x-forwarded-proto': 'https' },
      }),
    );
    expect(tls.headers.get('strict-transport-security'))
      .toContain('max-age=31536000');
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
  it('allows the limit, rejects excess, then resets', () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimitExceeded(key, 3, 1_000)).toBe(false);
    }
    expect(rateLimitExceeded(key, 3, 1_000)).toBe(true);
    expect(rateLimitExceeded(key, 3, 1_000, Date.now() + 2_000))
      .toBe(false);
  });

  it('parses the first forwarded client IP', () => {
    expect(clientIp(req('http://localhost/', {
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    }))).toBe('1.2.3.4');
    expect(clientIp(req('http://localhost/'))).toBe('local');
  });
});

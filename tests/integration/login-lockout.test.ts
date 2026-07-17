import {
  afterAll,
  beforeAll,
  expect,
  it,
} from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupTestEnv,
  teardownTestEnv,
} from '../helpers/testEnv';

let dataDir: string;

beforeAll(async () => {
  dataDir = await setupTestEnv('redi-lockout-');
});

afterAll(async () => {
  await teardownTestEnv(dataDir);
});

function post(
  handler: (request: NextRequest) => Promise<Response>,
  body: unknown,
  ip = '203.0.113.10',
) {
  return handler(new NextRequest('http://test', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  }));
}

it('claims once under a setup race and locks each client independently', async () => {
  const setup = (await import('../../src/app/api/auth/setup/route')).POST;
  const login = (await import('../../src/app/api/auth/login/route')).POST;
  expect((await post(setup, {
    password: 'the-real-password-123',
    setupToken: 'wrong-token',
  })).status).toBe(403);
  const setupBody = {
    password: 'the-real-password-123',
    setupToken: 'test-setup-token-0123456789abcdef0123456789abcdef',
  };
  const setupResponses = await Promise.all([
    post(setup, setupBody),
    post(setup, setupBody, '203.0.113.11'),
  ]);
  expect(setupResponses.map((response) => response.status).sort())
    .toEqual([200, 403]);
  for (let i = 0; i < 5; i += 1) {
    const response = await post(login, { password: 'wrong-password' });
    expect([401, 403]).toContain(response.status);
  }
  const sixth = await post(login, { password: 'wrong-password' });
  expect([423, 429]).toContain(sixth.status);
  const otherClient = await post(
    login,
    { password: 'the-real-password-123' },
    '203.0.113.11',
  );
  expect(otherClient.status).toBe(200);
  expect(otherClient.headers.getSetCookie().every((cookie) =>
    !cookie.includes('Secure'))).toBe(true);
  const tlsLogin = login(new NextRequest('https://test', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.12',
    },
    body: JSON.stringify({ password: 'the-real-password-123' }),
  }));
  expect((await tlsLogin).headers.getSetCookie().every((cookie) =>
    cookie.includes('Secure'))).toBe(true);

  process.env.TRUST_PROXY_HOPS = '0';
  for (let i = 0; i < 5; i += 1) {
    const response = await login(new NextRequest('http://test', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `redi_csrf=attacker-chosen-${i}-0123456789`,
      },
      body: JSON.stringify({ password: 'wrong-password' }),
    }));
    expect(response.status).toBe(401);
  }
  const directLogin = await login(new NextRequest('http://test', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'redi_csrf=another-attacker-value-0123456789',
    },
    body: JSON.stringify({ password: 'the-real-password-123' }),
  }));
  expect(directLogin.status).toBe(200);
});

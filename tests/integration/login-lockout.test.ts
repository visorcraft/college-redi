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
) {
  return handler(new NextRequest('http://test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

it('locks out after 5 failed logins', async () => {
  const setup = (await import('../../src/app/api/auth/setup/route')).POST;
  const login = (await import('../../src/app/api/auth/login/route')).POST;
  const setupResponse = await post(setup, {
    password: 'the-real-password-123',
  });
  expect([200, 201]).toContain(setupResponse.status);
  for (let i = 0; i < 5; i += 1) {
    const response = await post(login, { password: 'wrong-password' });
    expect([401, 403]).toContain(response.status);
  }
  const sixth = await post(login, { password: 'wrong-password' });
  expect([423, 429]).toContain(sixth.status);
});

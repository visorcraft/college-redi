import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type RunningServer } from '../helpers/server';

let srv: RunningServer;
beforeAll(async () => {
  srv = await startTestServer();
}, 240_000);
afterAll(async () => {
  await srv.stop();
});

type Jar = Map<string, string>;

function jarFrom(res: Response, jar: Jar): Jar {
  for (const setCookie of res.headers.getSetCookie()) {
    const [pair] = setCookie.split(';');
    const idx = pair.indexOf('=');
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return jar;
}

function cookieHeader(jar: Jar): string {
  return [...jar.entries()].filter(([, v]) => v.length > 0).map(([k, v]) => `${k}=${v}`).join('; ');
}

const PASSWORD = 'correct horse battery staple';
let jar: Jar = new Map();

describe('auth flow (booted app, temp data dir)', () => {
  it('GET /api/health is public', async () => {
    const res = await fetch(`${srv.baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET / redirects a fresh install to /wizard', async () => {
    const res = await fetch(`${srv.baseUrl}/`, { redirect: 'manual' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/wizard');
  });

  it('GET /api/settings is 401 without a session', async () => {
    const res = await fetch(`${srv.baseUrl}/api/settings`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthenticated');
  });

  it('GET /api/auth/me reports setup state before and after setup', async () => {
    const before = await (await fetch(`${srv.baseUrl}/api/auth/me`)).json();
    expect(before).toMatchObject({
      authenticated: false,
      passwordSet: false,
      setupToken: 'it-setup-token-0123456789abcdef0123456789abcdef',
    });
    const res = await fetch(`${srv.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: PASSWORD,
        setupToken: 'it-setup-token-0123456789abcdef0123456789abcdef',
      }),
    });
    expect(res.status).toBe(200);
    jarFrom(res, jar);
    expect(jar.get('redi_session')).toBeTruthy();
    expect(jar.get('redi_csrf')).toBeTruthy();
    const after = await (await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { cookie: cookieHeader(jar) } })).json();
    expect(after).toMatchObject({ authenticated: true, passwordSet: true, wizardCompleted: false });
    expect(after).not.toHaveProperty('setupToken');
  });

  it('POST /api/auth/setup is closed once a password exists', async () => {
    const res = await fetch(`${srv.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'another password 123' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('setup_closed');
  });

  it('GET / redirects to /wizard after setup (first-run contract)', async () => {
    const res = await fetch(`${srv.baseUrl}/`, { redirect: 'manual', headers: { cookie: cookieHeader(jar) } });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/wizard');
  });

  it('PATCH /api/settings enforces the CSRF double-submit token', async () => {
    const noCsrf = await fetch(`${srv.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(jar) },
      body: JSON.stringify({ timezone: 'America/Chicago' }),
    });
    expect(noCsrf.status).toBe(403);
    const ok = await fetch(`${srv.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(jar), 'x-csrf-token': jar.get('redi_csrf') ?? '' },
      body: JSON.stringify({ timezone: 'America/Chicago' }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).timezone).toBe('America/Chicago');
  });

  it('PUT /api/settings/secret stores a secret; GET shows set:true without the value', async () => {
    const put = await fetch(`${srv.baseUrl}/api/settings/secret`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(jar), 'x-csrf-token': jar.get('redi_csrf') ?? '' },
      body: JSON.stringify({ name: 'ai.api_key', value: 'sk-it-secret-value' }),
    });
    expect(put.status).toBe(200);
    const get = await fetch(`${srv.baseUrl}/api/settings`, { headers: { cookie: cookieHeader(jar) } });
    const body = await get.text();
    expect(JSON.parse(body).secrets['ai.api_key']).toEqual({ set: true });
    expect(body).not.toContain('sk-it-secret-value');
  });

  it('GET /api/status returns system health', async () => {
    const res = await fetch(`${srv.baseUrl}/api/status`, { headers: { cookie: cookieHeader(jar) } });
    expect(res.status).toBe(200);
    const status = await res.json();
    expect(status.db).toMatchObject({ mode: 'embedded', ok: true });
    expect(status.scheduler).toMatchObject({ enabled: false });
  });

  it('GET /api/dashboard returns the dashboard composite', async () => {
    const res = await fetch(`${srv.baseUrl}/api/dashboard`, {
      headers: { cookie: cookieHeader(jar) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      today: { overdue: [], due_today: [] },
      progress: null,
      banners: expect.any(Array),
    });
  });

  it('logout clears the session; login with the wrong password is 401', async () => {
    const out = await fetch(`${srv.baseUrl}/api/auth/logout`, { method: 'POST', headers: { cookie: cookieHeader(jar) }, redirect: 'manual' });
    expect(out.status).toBe(204);
    jarFrom(out, jar);
    const root = await fetch(`${srv.baseUrl}/`, {
      headers: { cookie: cookieHeader(jar) },
      redirect: 'manual',
    });
    expect(root.status).toBe(307);
    expect(root.headers.get('location')).toContain('/login');
    const guarded = await fetch(`${srv.baseUrl}/api/settings`, { headers: { cookie: cookieHeader(jar) } });
    expect(guarded.status).toBe(401);
    const bad = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong password' }),
    });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.code).toBe('invalid_credentials');
  });

  it('login with the right password issues fresh cookies', async () => {
    const res = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    jarFrom(res, jar);
    const me = await (await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { cookie: cookieHeader(jar) } })).json();
    expect(me.authenticated).toBe(true);
  });

  it('password change keeps this session and invalidates other sessions', async () => {
    const oldSession = new Map(jar);
    const changed = await fetch(`${srv.baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieHeader(jar),
        'x-csrf-token': jar.get('redi_csrf') ?? '',
      },
      body: JSON.stringify({
        current_password: PASSWORD,
        new_password: 'new correct horse battery staple',
      }),
    });
    expect(changed.status).toBe(200);
    jarFrom(changed, jar);
    const current = await (await fetch(`${srv.baseUrl}/api/auth/me`, {
      headers: { cookie: cookieHeader(jar) },
    })).json();
    const old = await (await fetch(`${srv.baseUrl}/api/auth/me`, {
      headers: { cookie: cookieHeader(oldSession) },
    })).json();
    expect(current.authenticated).toBe(true);
    expect(old.authenticated).toBe(false);
  });

  it('locks out after 5 failed logins (429)', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: `wrong-${i}` }),
      });
      expect(res.status).toBe(401);
    }
    const threshold = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-threshold' }),
    });
    expect(threshold.status).toBe(429);
    const locked = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'still-wrong' }),
    });
    expect(locked.status).toBe(429);
    expect((await locked.json()).error.code).toBe('login_locked');
    expect(locked.headers.get('retry-after')).toBeTruthy();
    const correct = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'new correct horse battery staple' }),
    });
    expect(correct.status).toBe(429);
  });
});

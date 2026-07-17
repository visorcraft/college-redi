import { RemoteDatabase } from '@visorcraft/mongreldb-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';

let env: TestEnv;

beforeEach(async () => {
  env = makeTestEnv({
    DATABASE_MODE: 'remote',
    MONGRELDB_URL: 'http://mongrel.test:8453',
  });
  await resetServerState();
  (globalThis as typeof globalThis & { __rediDb?: unknown }).__rediDb = Object.assign(
    Object.create(RemoteDatabase.prototype),
    { sql: vi.fn(() => { throw new Error('ephemeral SQL must not be used'); }) },
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await resetServerState();
  env.cleanup();
});

describe('withSqlTransaction remote mode', () => {
  it('routes every statement through one daemon session and rolls back errors', async () => {
    const statements: Array<{ sql: string; session: string | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/sessions' && init?.method === 'POST') {
        return Response.json({ session_id: 'session-1' });
      }
      if (path === '/sessions/session-1' && init?.method === 'DELETE') {
        return new Response();
      }
      if (path === '/sql' && typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as { sql: string; query_id: string };
        statements.push({
          sql: body.sql,
          session: new Headers(init.headers).get('x-session-id'),
        });
        return new Response(new Uint8Array(), {
          headers: { 'x-mongreldb-query-id': body.query_id },
        });
      }
      throw new Error(`unexpected request ${init?.method ?? 'GET'} ${path}`);
    }));

    const { sqlExec, withSqlTransaction } = await import('../../src/server/db/sql');
    await expect(withSqlTransaction(async () => {
      await sqlExec('INSERT INTO example VALUES (1)');
      throw new Error('stop');
    })).rejects.toThrow('stop');

    expect(statements).toEqual([
      { sql: 'BEGIN', session: 'session-1' },
      { sql: 'INSERT INTO example VALUES (1)', session: 'session-1' },
      { sql: 'ROLLBACK', session: 'session-1' },
    ]);
  });

  it('recovers a committed result after the COMMIT response is lost', async () => {
    const statements: string[] = [];
    let commitQueryId = '';
    let statusChecks = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/sessions' && init?.method === 'POST') {
        return Response.json({ session_id: 'session-1' });
      }
      if (path === '/sessions/session-1' && init?.method === 'DELETE') {
        return new Response();
      }
      if (path.startsWith('/queries/')) {
        expect(path).toBe(`/queries/${commitQueryId}`);
        statusChecks += 1;
        return statusChecks === 1
          ? Response.json({
            committed: false,
            terminal_state: null,
            outcome: { committed: false },
          })
          : Response.json({
            committed: true,
            terminal_state: 'committed',
            outcome: { committed: true },
          });
      }
      if (path === '/sql' && typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as { sql: string; query_id: string };
        statements.push(body.sql);
        if (body.sql === 'COMMIT') {
          commitQueryId = body.query_id;
          throw new Error('response lost after commit');
        }
        return new Response(new Uint8Array(), {
          headers: { 'x-mongreldb-query-id': body.query_id },
        });
      }
      throw new Error(`unexpected request ${init?.method ?? 'GET'} ${path}`);
    }));

    const { sqlExec, withSqlTransaction } = await import('../../src/server/db/sql');
    expect(await withSqlTransaction(async () => {
      await sqlExec('INSERT INTO example VALUES (1)');
      return 42;
    })).toBe(42);
    expect(statements).toEqual(['BEGIN', 'INSERT INTO example VALUES (1)', 'COMMIT']);
    expect(statusChecks).toBe(2);
  });

  it('retries and logs close without turning a known commit into failure', async () => {
    let closeAttempts = 0;
    let callbackFails = false;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/sessions' && init?.method === 'POST') {
        return Response.json({ session_id: 'session-1' });
      }
      if (path === '/sessions/session-1' && init?.method === 'DELETE') {
        closeAttempts += 1;
        return new Response('close failed', { status: 503 });
      }
      if (path === '/sql' && typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as { query_id: string; sql: string };
        if (callbackFails && body.sql === 'ROLLBACK') {
          return new Response('rollback failed', { status: 503 });
        }
        return new Response(new Uint8Array(), {
          headers: { 'x-mongreldb-query-id': body.query_id },
        });
      }
      throw new Error(`unexpected request ${init?.method ?? 'GET'} ${path}`);
    }));

    const { withSqlTransaction } = await import('../../src/server/db/sql');
    await expect(withSqlTransaction(async () => 'ok')).resolves.toBe('ok');
    expect(closeAttempts).toBe(3);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('remote session close failed'));

    closeAttempts = 0;
    callbackFails = true;
    await expect(withSqlTransaction(async () => {
      if (callbackFails) throw new Error('primary');
    })).rejects.toThrow('primary');
    expect(closeAttempts).toBe(3);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('remote transaction rollback failed'));
  });
});

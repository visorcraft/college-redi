import { RemoteDatabase, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeTestEnv,
  resetServerState,
  type TestEnv,
} from '../helpers/env';

let env: TestEnv;
let embedded: KitDatabase;

beforeAll(async () => {
  env = makeTestEnv({ REDI_MASTER_KEY: 'ab'.repeat(32) });
  await resetServerState();
  const client = await import('../../src/server/db/client');
  embedded = await client.getDb() as KitDatabase;
  const { runMigrations } = await import('../../src/server/db/migrate');
  await runMigrations(embedded);

  const remote = Object.assign(Object.create(RemoteDatabase.prototype), {
    sql: embedded.sql.bind(embedded),
  }) as RemoteDatabase;
  (globalThis as typeof globalThis & { __rediDb?: unknown }).__rediDb = remote;
});

afterAll(() => {
  delete (globalThis as typeof globalThis & { __rediDb?: unknown }).__rediDb;
  embedded.close();
  env.cleanup();
});

describe('Phase 1 remote-mode core parity', () => {
  it('settings and encrypted secrets work through SQL only', async () => {
    const { getKitDb } = await import('../../src/server/db/client');
    await expect(getKitDb()).rejects.toThrow(/unavailable in remote mode/);

    const { getSettings, updateSettings } = await import(
      '../../src/server/settings'
    );
    expect((await getSettings()).timezone).toBe('UTC');
    await updateSettings({ timezone: 'America/Chicago' });
    expect((await getSettings()).timezone).toBe('America/Chicago');

    const { getSecret, setSecret } = await import('../../src/server/secrets');
    expect(await getSecret('ai.api_key')).toBeNull();
    await setSecret('ai.api_key', 'remote-secret');
    expect(await getSecret('ai.api_key')).toBe('remote-secret');
  });

  it('login lockout and scheduler leases work through SQL only', async () => {
    const {
      getLoginLockState,
      recordLoginFailure,
    } = await import('../../src/server/loginThrottle');
    for (let i = 0; i < 5; i += 1) await recordLoginFailure('remote');
    expect((await getLoginLockState('remote')).locked).toBe(true);

    const {
      acquireJobLease,
      releaseJobLease,
    } = await import('../../src/server/scheduler');
    expect(await acquireJobLease('remote-job', 60_000)).toBe(true);
    expect(await acquireJobLease('remote-job', 60_000)).toBe(false);
    await releaseJobLease('remote-job', 'ok');
    expect(await acquireJobLease('remote-job', 60_000)).toBe(true);
  });

  it('tool calls write remote-safe audit rows without parameters', async () => {
    const { registerAllTools } = await import('../../src/server/tools');
    const { callTool } = await import('../../src/server/tools/call');
    const { sqlRows } = await import('../../src/server/db/sql');
    registerAllTools();
    await callTool(
      'update_settings',
      { ai: { model: 'remote-model' } },
      { actor: 'user' },
    );
    const rows = await sqlRows<{
      actor: string;
      tool_name: string;
      detail: string;
    }>('SELECT actor, tool_name, detail FROM audit_log');
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: 'user',
        tool_name: 'update_settings',
      }),
    ]));
    expect(JSON.stringify(rows)).not.toContain('remote-model');
  });
});

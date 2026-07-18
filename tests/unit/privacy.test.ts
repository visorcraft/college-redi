import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';
import { runMigrations } from '@/server/db/migrate';
import { lit, sqlExec, sqlRows } from '@/server/db/sql';
import { setSecret } from '@/server/secrets';
import { deleteAllUserData, exportUserData } from '@/server/privacy';

let env: TestEnv;

beforeAll(async () => {
  env = makeTestEnv();
  await resetServerState();
  await runMigrations();
});

afterAll(async () => {
  await resetServerState();
  env.cleanup();
});

describe('privacy controls', () => {
  it('exports user records without secrets or token hashes', async () => {
    const now = new Date().toISOString();
    await sqlExec(
      `INSERT INTO tasks (id, title, category, status, source, created_at, updated_at) VALUES (` +
      `${lit('privacy-task')}, ${lit('Private title')}, 'other', 'pending', 'manual', ${lit(now)}, ${lit(now)})`,
    );
    await setSecret('ai.api_key', 'never-export-this');
    await sqlExec(
      `INSERT INTO mcp_tokens (id, name, token_hash, created_at) VALUES (` +
      `${lit('token-id')}, ${lit('Laptop')}, ${lit('never-export-hash')}, ${lit(now)})`,
    );

    const exported = JSON.stringify(await exportUserData());
    expect(exported).toContain('Private title');
    expect(exported).toContain('Laptop');
    expect(exported).not.toContain('never-export-this');
    expect(exported).not.toContain('never-export-hash');
  });

  it('deletes every user record in a temporary database', async () => {
    await deleteAllUserData();
    expect(await sqlRows('SELECT * FROM tasks')).toEqual([]);
    expect(await sqlRows('SELECT * FROM secrets')).toEqual([]);
    expect(await sqlRows('SELECT * FROM mcp_tokens')).toEqual([]);
  });
});

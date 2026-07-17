import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { KitDatabase } from '@visorcraft/mongreldb-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';
import { _resetDbForTests, getDb, getKitDb } from '@/server/db/client';
import { appSettings } from '../../db/schema';

let env: TestEnv;
beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
});
afterEach(async () => {
  await resetServerState();
  env.cleanup();
});

describe('getDb (embedded)', () => {
  it('creates an encrypted, credential-enforced database on first boot and reopens it', async () => {
    const db = await getDb();
    expect(db).toBeInstanceOf(KitDatabase);
    expect((db as KitDatabase).requireAuthEnabled()).toBe(true);
    _resetDbForTests();
    const reopened = await getDb();
    expect(reopened).toBeInstanceOf(KitDatabase);
    expect((reopened as KitDatabase).requireAuthEnabled()).toBe(true);
  });

  it('refuses the wrong password on reopen', async () => {
    await getDb();
    _resetDbForTests();
    process.env.MONGRELDB_DB_PASSWORD = 'wrong-password-00000000000000';
    await resetServerState();
    await expect(getDb()).rejects.toThrow();
  });

  it('stores no readable plaintext on disk (AES-256-GCM at rest)', async () => {
    const db = await getKitDb();
    db.insertInto(appSettings)
      .values({ id: 1n, payload: JSON.stringify({ ai: { model: 'gpt-5.6-luna' } }), updated_at: new Date().toISOString() })
      .executeSync();
    _resetDbForTests();
    const sentinel = 'gpt-5.6-luna';
    const blobs: Buffer[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else blobs.push(readFileSync(full));
      }
    };
    walk(path.join(env.dataDir, 'db'));
    expect(blobs.length).toBeGreaterThan(0);
    expect(Buffer.concat(blobs).includes(sentinel)).toBe(false);
  });
});

import { chmodSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { eq } from '@visorcraft/mongreldb-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';
import { _resetKeysForTests, getMasterKey } from '@/server/keys';
import { getSecret, setSecret } from '@/server/secrets';
import { getKitDb } from '@/server/db/client';
import { secrets } from '../../db/schema';

let env: TestEnv;
beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
});
afterEach(() => env.cleanup());

describe('master key', () => {
  it('generates <DATA_DIR>/master.key with mode 0600 and reuses it', async () => {
    const key = await getMasterKey();
    expect(key.length).toBe(32);
    const keyPath = path.join(env.dataDir, 'master.key');
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(keyPath).equals(key)).toBe(true);
    chmodSync(keyPath, 0o644);
    _resetKeysForTests();
    expect((await getMasterKey()).equals(key)).toBe(true);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
  });

  it('prefers REDI_MASTER_KEY (hex) over the keyfile', async () => {
    const hex = 'ab'.repeat(32);
    env.cleanup();
    env = makeTestEnv({ REDI_MASTER_KEY: hex });
    await resetServerState();
    expect((await getMasterKey()).equals(Buffer.from(hex, 'hex'))).toBe(true);
  });
});

describe('secret store', () => {
  it('round-trips values, rotates, and returns null for missing names', async () => {
    expect(await getSecret('ai.api_key')).toBeNull();
    await setSecret('ai.api_key', 'sk-roundtrip');
    expect(await getSecret('ai.api_key')).toBe('sk-roundtrip');
    await setSecret('ai.api_key', 'sk-rotated');
    expect(await getSecret('ai.api_key')).toBe('sk-rotated');
  });

  it('detects tampering via the GCM auth tag', async () => {
    await setSecret('imap.password', 'hunter2');
    const db = await getKitDb();
    const nameColumn = secrets.column('name');
    const rows = db.selectFrom(secrets).where(eq(nameColumn, 'imap.password')).executeSync();
    const tampered = Buffer.from(rows[0].ciphertext as Uint8Array);
    tampered[20] = tampered[20] ^ 0xff;
    db.updateTable(secrets).set({ ciphertext: new Uint8Array(tampered) }).where(eq(nameColumn, 'imap.password')).executeSync();
    await expect(getSecret('imap.password')).rejects.toThrow();
  });
});

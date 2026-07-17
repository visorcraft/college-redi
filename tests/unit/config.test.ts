import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';
import { getConfig, requireDbCredentials } from '@/server/config';

let env: TestEnv;
beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
});
afterEach(() => env.cleanup());

describe('getConfig', () => {
  it('applies Appendix A defaults', () => {
    const cfg = getConfig();
    expect(cfg.DATABASE_MODE).toBe('embedded');
    expect(cfg.MONGRELDB_PATH).toBe(path.join(env.dataDir, 'db'));
    expect(cfg.MONGRELDB_URL).toBe('http://127.0.0.1:8453');
    expect(cfg.MONGRELDB_DB_USERNAME).toBe('redi');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.SCHEDULER_ENABLED).toBe(false);
    expect(cfg.LOG_LEVEL).toBe('info');
  });

  it('loads $DATA_DIR/.env without overriding real env vars', async () => {
    delete process.env.MONGRELDB_PASSPHRASE;
    writeFileSync(
      path.join(env.dataDir, '.env'),
      ['MONGRELDB_DB_PASSWORD=from-file-password', 'MONGRELDB_PASSPHRASE=from-file-passphrase', 'DATABASE_MODE=remote'].join('\n'),
      { mode: 0o600 },
    );
    await resetServerState();
    const cfg = getConfig();
    expect(cfg.MONGRELDB_DB_PASSWORD).toBe('unit-db-password-0123456789ab');
    expect(cfg.DATABASE_MODE).toBe('embedded');
    expect(cfg.MONGRELDB_PASSPHRASE).toBe('from-file-passphrase');
  });

  it('rejects an invalid DATABASE_MODE', async () => {
    process.env.DATABASE_MODE = 'bogus';
    await resetServerState();
    expect(() => getConfig()).toThrow();
  });
});

describe('requireDbCredentials', () => {
  it('returns credentials, and throws a bootstrap hint when they are missing', async () => {
    expect(requireDbCredentials().username).toBe('redi');
    delete process.env.MONGRELDB_DB_PASSWORD;
    delete process.env.MONGRELDB_PASSPHRASE;
    await resetServerState();
    expect(() => requireDbCredentials()).toThrow(/bootstrap-env/);
  });
});

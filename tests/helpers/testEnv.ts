import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV_KEYS = [
  'DATA_DIR',
  'DATABASE_MODE',
  'MONGRELDB_PATH',
  'MONGRELDB_DB_USERNAME',
  'MONGRELDB_DB_PASSWORD',
  'MONGRELDB_PASSPHRASE',
  'REDI_MASTER_KEY',
  'SESSION_SECRET',
] as const;
let previousEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

export async function setupTestEnv(prefix: string): Promise<string> {
  previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  process.env.DATA_DIR = dataDir;
  process.env.DATABASE_MODE = 'embedded';
  delete process.env.MONGRELDB_PATH;
  process.env.MONGRELDB_DB_USERNAME = 'redi';
  process.env.MONGRELDB_DB_PASSWORD = 'test-db-password';
  process.env.MONGRELDB_PASSPHRASE = 'test-passphrase';
  process.env.REDI_MASTER_KEY = 'a'.repeat(64);
  process.env.SESSION_SECRET = 'test-session-secret';

  const { _resetDbForTests } = await import('../../src/server/db/client');
  const { _resetConfigForTests } = await import('../../src/server/config');
  const { _resetKeysForTests } = await import('../../src/server/keys');
  const { _resetRegistryForTests } = await import('../../src/server/tools/registry');
  const { _resetToolsForTests, registerAllTools } = await import('../../src/server/tools');
  _resetDbForTests();
  _resetConfigForTests();
  _resetKeysForTests();
  _resetRegistryForTests();
  _resetToolsForTests();
  const { runMigrations } = await import('../../src/server/db/migrate');
  await runMigrations();
  registerAllTools();
  return dataDir;
}

export async function teardownTestEnv(dataDir: string): Promise<void> {
  const { _resetDbForTests } = await import('../../src/server/db/client');
  const { _resetConfigForTests } = await import('../../src/server/config');
  const { _resetKeysForTests } = await import('../../src/server/keys');
  const { _resetRegistryForTests } = await import('../../src/server/tools/registry');
  const { _resetToolsForTests } = await import('../../src/server/tools');
  _resetDbForTests();
  _resetConfigForTests();
  _resetKeysForTests();
  _resetRegistryForTests();
  _resetToolsForTests();
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dataDir, { recursive: true, force: true });
}

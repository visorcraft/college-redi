import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir = '';
const ENV_KEYS = [
  'DATA_DIR',
  'DATABASE_MODE',
  'MONGRELDB_PATH',
  'MONGRELDB_DB_USERNAME',
  'MONGRELDB_DB_PASSWORD',
  'MONGRELDB_PASSPHRASE',
  'REDI_MASTER_KEY',
  'SCHEDULER_ENABLED',
] as const;
let previousEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

export async function setupTestDb(): Promise<void> {
  previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  dir = mkdtempSync(join(tmpdir(), 'redi-p4-'));
  process.env.DATA_DIR = dir;
  process.env.DATABASE_MODE = 'embedded';
  process.env.MONGRELDB_PATH = join(dir, 'db');
  process.env.MONGRELDB_DB_USERNAME = 'redi';
  process.env.MONGRELDB_DB_PASSWORD = 'test-db-password';
  process.env.MONGRELDB_PASSPHRASE = 'test-passphrase';
  process.env.REDI_MASTER_KEY = 'a'.repeat(64);
  process.env.SCHEDULER_ENABLED = 'false';

  const { _resetDbForTests } = await import('../../src/server/db/client');
  const { _resetConfigForTests } = await import('../../src/server/config');
  const { _resetRegistryForTests } = await import('../../src/server/tools/registry');
  const { _resetToolsForTests, registerAllTools } = await import('../../src/server/tools');
  _resetDbForTests();
  _resetConfigForTests();
  _resetRegistryForTests();
  _resetToolsForTests();

  const { runMigrations } = await import('../../src/server/db/migrate');
  await runMigrations();
  registerAllTools();
}

export async function cleanTables(): Promise<void> {
  const { sqlExec } = await import('../../src/server/db/sql');
  for (const table of [
    'notification_history',
    'notifications',
    'tasks',
    'job_leases',
    'planned_courses',
    'terms',
    'emails_processed',
  ]) {
    await sqlExec(`DELETE FROM ${table}`);
  }
}

export async function teardownTestDb(): Promise<void> {
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
  rmSync(dir, { recursive: true, force: true });
}

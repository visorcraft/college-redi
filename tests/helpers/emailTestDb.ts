import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

/** Fresh embedded MongrelDB in a temp dir with all migrations applied. */
export async function freshEmailTestDb(): Promise<string> {
  try {
    const { _resetDbForTests } = await import('../../src/server/db/client');
    _resetDbForTests();
    const { _resetConfigForTests } = await import('../../src/server/config');
    _resetConfigForTests();
  } catch {
    // No database module is active on the first test file.
  }
  const dir = mkdtempSync(join(tmpdir(), 'redi-email-'));
  process.env.DATA_DIR = dir;
  process.env.DATABASE_MODE = 'embedded';
  delete process.env.MONGRELDB_PATH;
  process.env.MONGRELDB_PASSPHRASE = 'test-passphrase';
  process.env.MONGRELDB_DB_USERNAME = 'redi';
  process.env.MONGRELDB_DB_PASSWORD = 'test-password';
  process.env.REDI_MASTER_KEY = 'a'.repeat(64);
  vi.resetModules();
  const { runMigrations } = await import('../../src/server/db/migrate');
  await runMigrations();
  return dir;
}

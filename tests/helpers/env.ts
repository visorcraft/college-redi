import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface TestEnv {
  dataDir: string;
  cleanup(): void;
}

export function makeTestEnv(overrides: Record<string, string> = {}): TestEnv {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'redi-unit-'));
  process.env.DATA_DIR = dataDir;
  process.env.DATABASE_MODE = 'embedded';
  process.env.MONGRELDB_DB_USERNAME = 'redi';
  process.env.MONGRELDB_DB_PASSWORD = 'unit-db-password-0123456789ab';
  process.env.MONGRELDB_PASSPHRASE = 'unit-passphrase-0123456789abcd';
  process.env.SESSION_SECRET = 'unit-session-secret';
  process.env.SCHEDULER_ENABLED = 'false';
  delete process.env.REDI_MASTER_KEY;
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  return { dataDir, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

// Each entry is dynamically imported so this helper works in early tasks before
// every server module exists; a missing module simply has nothing to reset yet.
const RESETTERS: Array<[string, string]> = [
  ['@/server/db/client', '_resetDbForTests'],
  ['@/server/config', '_resetConfigForTests'],
  ['@/server/keys', '_resetKeysForTests'],
  ['@/server/tools/registry', '_resetRegistryForTests'],
  ['@/server/tools', '_resetToolsForTests'],
  ['@/server/bootstrap', '_resetBootstrapForTests'],
  ['@/server/loginThrottle', '_resetLoginThrottleForTests'],
];

export async function resetServerState(): Promise<void> {
  for (const [modulePath, exportName] of RESETTERS) {
    try {
      const mod = (await import(modulePath)) as Record<string, unknown>;
      const fn = mod[exportName];
      if (typeof fn === 'function') (fn as () => void)();
    } catch {
      // module not created yet in this phase — nothing to reset
    }
  }
}

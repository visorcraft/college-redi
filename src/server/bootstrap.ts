import { getConfig } from './config';
import { getDb } from './db/client';
import { runMigrations } from './db/migrate';
import { startScheduler } from './scheduler';
import { registerAllTools } from './tools';

const globalState = globalThis as typeof globalThis & { __rediBootPromise?: Promise<void> };

/** Idempotent app boot: open the DB, migrate, register tools, start the scheduler. */
export function ensureBootstrapped(): Promise<void> {
  if (!globalState.__rediBootPromise) globalState.__rediBootPromise = bootstrap();
  return globalState.__rediBootPromise;
}

export async function bootstrap(): Promise<void> {
  const cfg = getConfig();
  const db = await getDb();
  await runMigrations(db);
  registerAllTools();
  if (cfg.SCHEDULER_ENABLED) await startScheduler();
  console.log(
    JSON.stringify({ level: 'info', msg: 'redi bootstrap complete', mode: cfg.DATABASE_MODE, scheduler: cfg.SCHEDULER_ENABLED }),
  );
}

export function _resetBootstrapForTests(): void {
  delete globalState.__rediBootPromise;
}

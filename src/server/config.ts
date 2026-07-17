import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().min(1).default('./data'),
  DATABASE_MODE: z.enum(['embedded', 'remote']).default('embedded'),
  MONGRELDB_PATH: z.string().min(1).optional(),
  MONGRELDB_URL: z.string().url().default('http://127.0.0.1:8453'),
  MONGRELDB_DB_USERNAME: z.string().min(1).default('redi'),
  MONGRELDB_DB_PASSWORD: z.string().min(1).optional(),
  MONGRELDB_PASSPHRASE: z.string().min(1).optional(),
  REDI_MASTER_KEY: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(1).optional(),
  SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  CRON_SECRET: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TZ: z.string().optional(),
});

export type AppConfig = Omit<z.infer<typeof ConfigSchema>, 'MONGRELDB_PATH'> & { MONGRELDB_PATH: string };

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const dataDir = process.env.DATA_DIR?.trim() || './data';
  // Load bootstrap credentials written by scripts/bootstrap-env.sh (spec §4.6).
  // dotenv never overrides variables already present in process.env; a missing file is fine.
  dotenv.config({ path: path.join(dataDir, '.env') });
  const parsed = ConfigSchema.parse(process.env);
  cached = { ...parsed, MONGRELDB_PATH: parsed.MONGRELDB_PATH ?? path.join(parsed.DATA_DIR, 'db') };
  return cached;
}

export interface DbCredentials {
  username: string;
  password: string;
  passphrase: string;
}

export function requireDbCredentials(cfg: AppConfig = getConfig()): DbCredentials {
  if (!cfg.MONGRELDB_DB_PASSWORD || !cfg.MONGRELDB_PASSPHRASE) {
    throw new Error(
      'MongrelDB credentials are missing. Run `sh scripts/bootstrap-env.sh` first — it generates ' +
        'MONGRELDB_DB_PASSWORD and MONGRELDB_PASSPHRASE into $DATA_DIR/.env (spec §4.6).',
    );
  }
  return { username: cfg.MONGRELDB_DB_USERNAME, password: cfg.MONGRELDB_DB_PASSWORD, passphrase: cfg.MONGRELDB_PASSPHRASE };
}

export function _resetConfigForTests(): void {
  cached = null;
}

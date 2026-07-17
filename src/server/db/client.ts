import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { KitDatabase, RemoteDatabase } from '@visorcraft/mongreldb-kit';
import { getConfig, requireDbCredentials } from '../config';
import { schema } from '../../../db/schema';

export type AppDb = KitDatabase | RemoteDatabase;

const globalState = globalThis as typeof globalThis & { __rediDb?: AppDb };

export async function getDb(): Promise<AppDb> {
  if (globalState.__rediDb) return globalState.__rediDb;
  const cfg = getConfig();
  const creds = requireDbCredentials(cfg);
  if (cfg.DATABASE_MODE === 'remote') {
    globalState.__rediDb = new RemoteDatabase(cfg.MONGRELDB_URL, {
      auth: { username: creds.username, password: creds.password },
    });
    return globalState.__rediDb;
  }
  mkdirSync(path.dirname(cfg.MONGRELDB_PATH), { recursive: true });
  const options = {
    encryption: { passphrase: creds.passphrase },
    credentials: { username: creds.username, password: creds.password },
  };
  try {
    globalState.__rediDb = KitDatabase.openSync(cfg.MONGRELDB_PATH, schema, options);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'MONGRELDB_NOT_FOUND') {
      globalState.__rediDb = KitDatabase.createEncryptedWithCredentialsSync(
        cfg.MONGRELDB_PATH,
        schema,
        creds.passphrase,
        creds.username,
        creds.password,
      );
    } else if (code === 'MONGRELDB_DATABASE_LOCKED') {
      throw new Error(
        `MongrelDB at ${cfg.MONGRELDB_PATH} is locked — another Redi/MongrelDB process owns it (spec §13). ` +
          'Stop the other process, or run with DATABASE_MODE=remote against a daemon.',
      );
    } else {
      throw err;
    }
  }
  return globalState.__rediDb;
}

/** Embedded-only handle for modules that use the Kit query builder. See plan note 4 (remote-mode gap). */
export async function getKitDb(): Promise<KitDatabase> {
  const db = await getDb();
  if (!(db instanceof KitDatabase)) {
    throw new Error('Kit query builder is unavailable in remote mode; use SQL via getDb() instead.');
  }
  return db;
}

export function _resetDbForTests(): void {
  if (globalState.__rediDb instanceof KitDatabase) globalState.__rediDb.close();
  delete globalState.__rediDb;
}

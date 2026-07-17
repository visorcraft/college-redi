import { KitDatabase, type TableSpec } from '@visorcraft/mongreldb-kit';
import { getDb, type AppDb } from './client';
import { schema } from '../../../db/schema';
import { migrations } from '../../../db/migrations';

export async function runMigrations(db?: AppDb): Promise<void> {
  const handle = db ?? (await getDb());
  if (handle instanceof KitDatabase) {
    handle.migrateSync(schema, migrations);
    return;
  }
  const existing = new Set(handle.tableNames());
  for (const t of schema.tablesList()) {
    if (existing.has(t.name)) continue;
    await handle.sql(createTableSql(t));
  }
}

const SQL_TYPES: Record<string, string> = {
  int64: 'bigint',
  float64: 'double',
  bool: 'boolean',
  text: 'text',
  json: 'text',
  timestamp: 'timestamp',
  date: 'date',
  bytes: 'blob',
  uuid: 'text',
};

export function createTableSql(t: TableSpec): string {
  const cols = t.columns.map((c) => {
    const ty = SQL_TYPES[c.storageType];
    if (!ty) throw new Error(`no SQL type mapping for storage type '${c.storageType}' (${t.name}.${c.name})`);
    return `"${c.name}" ${ty}`;
  });
  return `CREATE TABLE IF NOT EXISTS "${t.name}" (${cols.join(', ')})`;
}

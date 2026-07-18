import { KitDatabase, RemoteDatabase, type TableSpec } from '@visorcraft/mongreldb-kit';
import { tableFromIPC } from 'apache-arrow';
import { getConfig, requireDbCredentials } from '../config';
import { getDb, type AppDb } from './client';
import { schema } from '../../../db/schema';
import { migrations } from '../../../db/migrations';
import { lit } from './sql';

const MIGRATIONS_TABLE = '__redi_schema_migrations';

type RemoteColumn = {
  id: number;
  name: string;
  ty: string;
  primary_key: boolean;
  nullable: boolean;
  auto_increment: boolean;
  encrypted: boolean;
  encrypted_indexable: boolean;
  enum_variants?: string[];
  default_expr?: string;
  default_value?: unknown;
};

export type RemoteTableDefinition = {
  name: string;
  columns: RemoteColumn[];
  indexes: Array<{ name: string; column_id: number; kind: string }>;
  constraints: {
    uniques: Array<{ id: number; name: string; columns: number[] }>;
    foreign_keys: Array<{
      id: number;
      name: string;
      columns: number[];
      ref_table: string;
      ref_columns: number[];
      on_delete: 'Cascade' | 'Restrict' | 'SetNull';
      on_update: 'Restrict';
    }>;
    checks: never[];
  };
};

type RemoteSchemaDescriptor = {
  columns: Array<{
    id: number;
    name: string;
    ty: string;
    primary_key: boolean;
    nullable: boolean;
  }>;
  indexes: Array<{ name: string; column_id: number; kind: string }>;
  constraints: {
    uniques: Array<{ id: number; name: string; columns: number[] }>;
    foreign_keys: Array<{
      id: number;
      name: string;
      columns: number[];
      ref_table: string;
      ref_columns: number[];
      on_delete: string;
      on_update: string;
    }>;
  };
};

export async function runMigrations(db?: AppDb): Promise<void> {
  const handle = db ?? (await getDb());
  if (handle instanceof KitDatabase) {
    handle.migrateSync(schema, migrations);
    return;
  }

  const sql = (statement: string) => handle.sql(
    statement,
    handle instanceof RemoteDatabase ? { timeoutMs: 30_000 } : undefined,
  );
  await sql(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (` +
      '"version" bigint PRIMARY KEY, "name" text NOT NULL, "applied_at" text NOT NULL)',
  );
  const result: unknown = await sql(`SELECT "version" FROM "${MIGRATIONS_TABLE}"`);
  const rows = result instanceof Uint8Array ? tableFromIPC(result) : result as Iterable<unknown>;
  const applied = new Set<number>();
  for (const row of rows) {
    applied.add(Number((row as unknown as { version: number | bigint | string }).version));
  }

  const existing = new Set(handle.tableNames());
  existing.delete(MIGRATIONS_TABLE);
  for (const table of schema.tablesList()) {
    if (existing.has(table.name)) {
      assertRemoteSchema(table, await remoteSchema(table.name));
    }
  }

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    if (migration.version === 1) {
      const pending = schema.tablesList().filter((table) => !existing.has(table.name));
      while (pending.length > 0) {
        const index = pending.findIndex((table) =>
          table.foreignKeys.every((foreignKey) => existing.has(foreignKey.referencesTable)));
        if (index < 0) throw new Error('remote migration has a foreign-key dependency cycle');
        const [table] = pending.splice(index, 1);
        await createRemoteTable(table);
        existing.add(table.name);
      }
    } else if (migration.version === 2) {
      const descriptor = await remoteSchema('notifications');
      if (!descriptor.columns.some((column) => column.name === 'read_at')) {
        await sql('ALTER TABLE "notifications" ADD COLUMN "read_at" text NULL');
      }
    } else {
      throw new Error(`remote migration ${migration.version} (${migration.name}) is not implemented`);
    }
    await sql(
      `INSERT INTO "${MIGRATIONS_TABLE}" ("version", "name", "applied_at") VALUES (` +
        `${migration.version}, ${lit(migration.name)}, ${lit(new Date().toISOString())})`,
    );
  }

  const notifications = await remoteSchema('notifications');
  const readAt = notifications.columns.find((column) => column.name === 'read_at');
  if (!readAt || readAt.ty !== 'bytes' || !readAt.nullable) {
    throw new Error('remote schema mismatch for notifications.read_at');
  }
}

export function remoteTableDefinition(table: TableSpec): RemoteTableDefinition {
  if (table.checks.length > 0) {
    throw new Error(`remote table ${table.name} has non-serializable Kit checks`);
  }
  const columnId = (name: string) => table.column(name).id;
  const columns: RemoteColumn[] = table.columns.map((column) => {
    if (column.default?.kind === 'custom') {
      throw new Error(`remote column ${table.name}.${column.name} has a custom default`);
    }
    const definition: RemoteColumn = {
      id: column.id,
      name: column.name,
      ty: column.enumValues ? 'enum' : remoteType(column.storageType),
      primary_key: column.primaryKey || table.primaryKey.includes(column.name),
      nullable: column.nullable,
      auto_increment: column.default?.kind === 'sequence',
      encrypted: column.encrypted ?? false,
      encrypted_indexable: column.encryptedIndexable ?? false,
    };
    if (column.enumValues) definition.enum_variants = column.enumValues;
    if (column.default?.kind === 'static') definition.default_value = column.default.value;
    if (column.default?.kind === 'now' || column.default?.kind === 'uuid') {
      definition.default_expr = column.default.kind;
    } else if (column.generated) {
      definition.default_expr = column.generated;
    }
    return definition;
  });

  const indexes: RemoteTableDefinition['indexes'] = [];
  const indexed = new Set<string>();
  for (const index of table.indexes) {
    for (const name of index.columns) {
      indexes.push({ name: `${index.name}_${name}`, column_id: columnId(name), kind: index.kind ?? 'bitmap' });
      indexed.add(name);
    }
  }
  for (const name of table.primaryKey) {
    if (!indexed.has(name)) {
      indexes.push({ name: `pk_${name}`, column_id: columnId(name), kind: 'bitmap' });
      indexed.add(name);
    }
  }
  for (const foreignKey of table.foreignKeys) {
    for (const name of foreignKey.columns) {
      if (!indexed.has(name)) {
        indexes.push({
          name: `fk_${foreignKey.name}_${name}`,
          column_id: columnId(name),
          kind: 'bitmap',
        });
        indexed.add(name);
      }
    }
  }

  return {
    name: table.name,
    columns,
    indexes,
    constraints: {
      uniques: table.unique.map((unique, index) => ({
        id: index + 1,
        name: unique.name,
        columns: unique.columns.map(columnId),
      })),
      foreign_keys: table.foreignKeys.map((foreignKey, index) => ({
        id: table.unique.length + index + 1,
        name: foreignKey.name,
        columns: foreignKey.columns.map(columnId),
        ref_table: foreignKey.referencesTable,
        ref_columns: foreignKey.referencesColumns.map(
          (name) => schema.table(foreignKey.referencesTable).column(name).id,
        ),
        on_delete: remoteFkAction(foreignKey.onDelete),
        on_update: 'Restrict',
      })),
      checks: [],
    },
  };
}

async function createRemoteTable(table: TableSpec): Promise<void> {
  const response = await remoteRequest('/kit/create_table', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(remoteTableDefinition(table)),
  });
  if (!response.ok) {
    throw new Error(`remote table creation failed for ${table.name}: ${await response.text()}`);
  }
}

async function remoteSchema(table: string): Promise<RemoteSchemaDescriptor> {
  const response = await remoteRequest(`/kit/schema/${encodeURIComponent(table)}`);
  if (!response.ok) throw new Error(`remote schema lookup failed for ${table}: ${await response.text()}`);
  return await response.json() as RemoteSchemaDescriptor;
}

async function remoteRequest(path: string, init?: RequestInit): Promise<Response> {
  const config = getConfig();
  const credentials = requireDbCredentials(config);
  const headers = new Headers(init?.headers);
  headers.set(
    'authorization',
    `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString('base64')}`,
  );
  return fetch(`${config.MONGRELDB_URL.replace(/\/$/, '')}${path}`, {
    ...init,
    headers,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
}

function assertRemoteSchema(table: TableSpec, actual: RemoteSchemaDescriptor): void {
  const expected = remoteTableDefinition(table);
  const mismatch = (detail: string): never => {
    throw new Error(`remote schema mismatch for ${table.name}: ${detail}`);
  };
  const extraColumns = actual.columns.filter(
    (column) => !expected.columns.some((candidate) => candidate.name === column.name),
  );
  if (
    actual.columns.length < expected.columns.length ||
    extraColumns.some((column) =>
      table.name !== 'notifications' ||
      column.name !== 'read_at' ||
      column.ty !== 'bytes' ||
      !column.nullable)
  ) mismatch('column count');
  for (const column of expected.columns) {
    const found = actual.columns.find((candidate) => candidate.name === column.name)
      ?? mismatch(`missing column ${column.name}`);
    if (
      found.id !== column.id ||
      found.ty !== column.ty ||
      found.primary_key !== column.primary_key ||
      found.nullable !== column.nullable
    ) mismatch(`column ${column.name} flags or type`);
  }
  const actualIndexes = actual.indexes.map(({ name, column_id, kind }) => ({ name, column_id, kind }));
  if (JSON.stringify(actualIndexes) !== JSON.stringify(expected.indexes)) mismatch('indexes');
  const actualUniques = actual.constraints.uniques.map(({ id, name, columns }) => ({ id, name, columns }));
  const actualForeignKeys = actual.constraints.foreign_keys.map((foreignKey) => ({
    id: foreignKey.id,
    name: foreignKey.name,
    columns: foreignKey.columns,
    ref_table: foreignKey.ref_table,
    ref_columns: foreignKey.ref_columns,
    on_delete: foreignKey.on_delete,
    on_update: foreignKey.on_update,
  }));
  if (
    JSON.stringify(actualUniques) !== JSON.stringify(expected.constraints.uniques) ||
    JSON.stringify(actualForeignKeys) !== JSON.stringify(
      expected.constraints.foreign_keys.map((foreignKey) => ({
        ...foreignKey,
        on_delete: foreignKey.on_delete.toLowerCase(),
        on_update: foreignKey.on_update.toLowerCase(),
      })),
    )
  ) mismatch('constraints');
}

function remoteFkAction(action: 'cascade' | 'set null' | 'restrict'): 'Cascade' | 'Restrict' | 'SetNull' {
  if (action === 'cascade') return 'Cascade';
  if (action === 'set null') return 'SetNull';
  return 'Restrict';
}

function remoteType(storageType: string): string {
  const types: Record<string, string> = {
    bool: 'bool',
    int64: 'int64',
    float64: 'float64',
    timestamp: 'bytes',
    date: 'bytes',
    text: 'bytes',
    bytes: 'bytes',
    json: 'bytes',
  };
  const type = types[storageType];
  if (!type) throw new Error(`no remote type mapping for storage type '${storageType}'`);
  return type;
}

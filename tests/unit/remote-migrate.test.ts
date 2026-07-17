import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { RemoteDatabase } from '@visorcraft/mongreldb-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { courses, degreePrograms, schema } from '../../db/schema';
import { remoteTableDefinition, runMigrations } from '@/server/db/migrate';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';

let env: TestEnv;

beforeEach(async () => {
  env = makeTestEnv({
    DATABASE_MODE: 'remote',
    MONGRELDB_URL: 'http://mongrel.test:8453',
  });
  await resetServerState();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await resetServerState();
  env.cleanup();
});

describe('remote migrations', () => {
  it('preserves primary keys, nullability, defaults, indexes, unique constraints, and foreign keys', () => {
    const program = remoteTableDefinition(degreePrograms);
    expect(program.columns.find((column) => column.name === 'id')).toMatchObject({
      primary_key: true,
      nullable: false,
    });
    expect(program.columns.find((column) => column.name === 'status')).toMatchObject({
      nullable: false,
      default_value: 'active',
      enum_variants: ['active', 'completed', 'abandoned'],
    });

    const course = remoteTableDefinition(courses);
    expect(course.columns.find((column) => column.name === 'description')?.nullable).toBe(true);
    expect(course.columns.find((column) => column.name === 'prerequisites')?.default_value).toBe('[]');
    expect(course.constraints.uniques).toEqual([
      expect.objectContaining({
        name: 'uq_program_id_code',
        columns: [courses.column('program_id').id, courses.column('code').id],
      }),
    ]);
    expect(course.constraints.foreign_keys).toEqual([
      expect.objectContaining({
        id: 2,
        name: 'fk_program_id_degree_programs',
        ref_table: 'degree_programs',
        on_delete: 'Cascade',
      }),
    ]);
  });

  it('creates constraint-aware tables, applies 0002 read_at once, and records versions', async () => {
    const tables = new Set<string>();
    const descriptors = new Map<string, ReturnType<typeof descriptor>>();
    const versions = new Set<number>();
    let alterCount = 0;
    const sql = vi.fn(async (statement: string, options?: { timeoutMs?: number }) => {
      expect(options?.timeoutMs).toBe(30_000);
      if (statement.startsWith('CREATE TABLE IF NOT EXISTS "__redi_schema_migrations"')) {
        tables.add('__redi_schema_migrations');
      } else if (statement.startsWith('SELECT "version"')) {
        return Buffer.from(tableToIPC(tableFromArrays({ version: [...versions] })));
      } else if (statement.startsWith('INSERT INTO "__redi_schema_migrations"')) {
        versions.add(Number(statement.match(/VALUES \((\d+)/)?.[1]));
      } else if (statement.startsWith('ALTER TABLE "notifications"')) {
        alterCount += 1;
        descriptors.get('notifications')?.columns.push({
          id: 13,
          name: 'read_at',
          ty: 'bytes',
          primary_key: false,
          nullable: true,
        });
      }
      return tableFromArrays({});
    });
    const remote = Object.assign(Object.create(RemoteDatabase.prototype), {
      tableNames: () => [...tables],
      sql,
    }) as RemoteDatabase;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const url = String(_input);
      if (url.endsWith('/kit/create_table')) {
        const definition = JSON.parse(String(init?.body)) as ReturnType<typeof remoteTableDefinition>;
        tables.add(definition.name);
        descriptors.set(definition.name, descriptor(definition));
        return Response.json({ table_id: tables.size });
      }
      const name = decodeURIComponent(url.split('/').at(-1) ?? '');
      const value = descriptors.get(name);
      return value ? Response.json(value) : Response.json({ error: 'not found' }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await runMigrations(remote);
    expect(versions).toEqual(new Set([1, 2]));
    expect(alterCount).toBe(1);
    expect(tables).toEqual(new Set([
      '__redi_schema_migrations',
      ...schema.tablesList().map((table) => table.name),
    ]));
    expect(
      (JSON.parse(String(fetchMock.mock.calls.find(([, init]) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string };
        return body.name === 'courses';
      })?.[1]?.body)) as ReturnType<typeof remoteTableDefinition>).constraints.foreign_keys,
    ).toHaveLength(1);

    await runMigrations(remote);
    expect(alterCount).toBe(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
      schema.tablesList().length,
    );
  });

  it('rejects a legacy remote table whose SQL-only schema lost constraints', async () => {
    const bad = descriptor(remoteTableDefinition(courses));
    bad.columns.find((column) => column.name === 'id')!.primary_key = false;
    const remote = Object.assign(Object.create(RemoteDatabase.prototype), {
      tableNames: () => ['courses'],
      sql: async (statement: string) =>
        statement.startsWith('SELECT') ? tableFromArrays({ version: [] }) : tableFromArrays({}),
    }) as RemoteDatabase;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/courses')
        ? Response.json(bad)
        : Response.json({ error: 'unexpected' }, { status: 500 })));

    await expect(runMigrations(remote)).rejects.toThrow(
      /remote schema mismatch for courses: column id flags or type/,
    );
  });
});

function descriptor(definition: ReturnType<typeof remoteTableDefinition>) {
  return {
    columns: definition.columns.map((column) => ({
      id: column.id,
      name: column.name,
      ty: column.ty,
      primary_key: column.primary_key,
      nullable: column.nullable,
    })),
    indexes: definition.indexes,
    constraints: {
      ...definition.constraints,
      foreign_keys: definition.constraints.foreign_keys.map((foreignKey) => ({
        ...foreignKey,
        on_delete: foreignKey.on_delete.toLowerCase(),
        on_update: foreignKey.on_update.toLowerCase(),
      })),
    },
  };
}

import { tableFromIPC, type Table } from 'apache-arrow';
import type { AppDb } from '../db/client';

export type SqlDb = AppDb;

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return value;
}

export async function sqlRows<T = Record<string, unknown>>(
  db: SqlDb,
  sql: string,
): Promise<T[]> {
  const result: unknown = await db.sql(sql);
  if (!result || result instanceof Uint8Array && result.byteLength === 0) return [];
  const table: Table = result instanceof Uint8Array ? tableFromIPC(result) : result as Table;
  return [...table].map((row) => Object.fromEntries(
    Object.entries(row as Record<string, unknown>)
      .map(([key, value]) => [key, normalize(value)]),
  ) as T);
}

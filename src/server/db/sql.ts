import { tableFromIPC, type Table } from 'apache-arrow';
import { getDb } from './client';

function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

export async function sqlRows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const result: unknown = await (await getDb()).sql(sql);
  if (!result || (result instanceof Uint8Array && result.byteLength === 0)) return [];
  const table: Table = result instanceof Uint8Array ? tableFromIPC(result) : result as Table;
  return [...table].map((row) => normalize({ ...row as Record<string, unknown> }) as T);
}

export async function sqlExec(sql: string): Promise<void> {
  await (await getDb()).sql(sql);
}

export const queryRows = sqlRows;
export const execSql = sqlExec;

export function lit(value: string | number | boolean | Date | null): string {
  if (value === null) return 'NULL';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('refusing non-finite number literal');
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

export const sqlString = (value: string): string => lit(value);

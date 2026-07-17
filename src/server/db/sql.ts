import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { tableFromIPC, type Table } from 'apache-arrow';
import { RemoteDatabase } from '@visorcraft/mongreldb-kit';
import { getConfig, requireDbCredentials } from '../config';
import { getDb } from './client';

type TransactionContext = { remoteSessionId?: string; embedded?: true };
const REMOTE_REQUEST_TIMEOUT_MS = 30_000;
const REMOTE_STATUS_TIMEOUT_MS = 2_000;
const globalState = globalThis as typeof globalThis & {
  __rediSqlTransactionContext?: AsyncLocalStorage<TransactionContext>;
  __rediEmbeddedTransactionTail?: Promise<void>;
};
const transactionContext = globalState.__rediSqlTransactionContext
  ??= new AsyncLocalStorage<TransactionContext>();
globalState.__rediEmbeddedTransactionTail ??= Promise.resolve();

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
  const context = transactionContext.getStore();
  const db = await getDb();
  const result: unknown = context?.remoteSessionId
    ? await remoteSessionSql(context.remoteSessionId, sql)
    : context?.embedded || db instanceof RemoteDatabase
      ? await db.sql(sql, db instanceof RemoteDatabase
        ? { timeoutMs: REMOTE_REQUEST_TIMEOUT_MS }
        : undefined)
      : await withEmbeddedQueue(() => db.sql(sql));
  if (!result || (result instanceof Uint8Array && result.byteLength === 0)) return [];
  const table: Table = result instanceof Uint8Array ? tableFromIPC(result) : result as Table;
  return [...table].map((row) => normalize({ ...row as Record<string, unknown> }) as T);
}

export async function sqlExec(sql: string): Promise<void> {
  await sqlRows(sql);
}

export const queryRows = sqlRows;
export const execSql = sqlExec;

function remoteHeaders(extra?: HeadersInit): Headers {
  const config = getConfig();
  const credentials = requireDbCredentials(config);
  const headers = new Headers(extra);
  headers.set(
    'authorization',
    `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
  );
  return headers;
}

async function remoteRequest(path: string, init: RequestInit): Promise<Response> {
  const base = getConfig().MONGRELDB_URL.replace(/\/$/, '');
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: remoteHeaders(init.headers),
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`MongrelDB ${path} failed with HTTP ${response.status}: ${detail}`);
  }
  return response;
}

async function openRemoteSession(): Promise<string> {
  const response = await remoteRequest('/sessions', { method: 'POST' });
  const body = await response.json() as { session_id?: unknown };
  if (typeof body.session_id !== 'string' || !body.session_id) {
    throw new Error('MongrelDB /sessions returned an invalid session_id');
  }
  return body.session_id;
}

async function closeRemoteSession(sessionId: string): Promise<void> {
  await remoteRequest(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

class RemoteSqlRequestError extends Error {
  constructor(readonly queryId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'RemoteSqlRequestError';
  }
}

async function remoteSessionSql(sessionId: string, sql: string): Promise<Uint8Array> {
  const queryId = randomUUID().replaceAll('-', '');
  try {
    const response = await remoteRequest('/sql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': sessionId,
      },
      body: JSON.stringify({ sql, format: 'arrow', query_id: queryId }),
    });
    if (response.headers.get('x-mongreldb-query-id') !== queryId) {
      throw new Error('MongrelDB /sql returned a mismatched query id');
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new RemoteSqlRequestError(queryId, error);
  }
}

type CommitOutcome = 'committed' | 'not_committed' | 'unknown';

async function resolveCommitOutcome(
  sessionId: string,
  error: unknown,
): Promise<CommitOutcome> {
  if (!(error instanceof RemoteSqlRequestError)) return 'unknown';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(
        `${getConfig().MONGRELDB_URL.replace(/\/$/, '')}/queries/${error.queryId}`,
        {
          headers: remoteHeaders({ 'x-session-id': sessionId }),
          signal: AbortSignal.timeout(REMOTE_STATUS_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        const body = await response.json() as {
          committed?: boolean | null;
          terminal_state?: string | null;
          outcome?: { committed?: boolean | null };
        };
        const committed = body.committed ?? body.outcome?.committed;
        if (committed === true) return 'committed';
        if (committed === false && body.terminal_state) return 'not_committed';
      }
    } catch {
      // Retry the bounded status check.
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return 'unknown';
}

async function closeRemoteSessionWithRetry(sessionId: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await closeRemoteSession(sessionId);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}

async function inRemoteTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const sessionId = await openRemoteSession();
  let primaryError: unknown;
  let committed = false;
  try {
    await remoteSessionSql(sessionId, 'BEGIN');
    let result: T;
    try {
      result = await transactionContext.run({ remoteSessionId: sessionId }, fn);
    } catch (error) {
      try {
        await remoteSessionSql(sessionId, 'ROLLBACK');
      } catch (rollbackError) {
        console.error(JSON.stringify({
          level: 'error',
          msg: 'remote transaction rollback failed',
          session_id: sessionId,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        }));
      }
      throw error;
    }
    try {
      await remoteSessionSql(sessionId, 'COMMIT');
    } catch (error) {
      const outcome = await resolveCommitOutcome(sessionId, error);
      if (outcome !== 'committed') {
        if (outcome === 'not_committed') {
          try {
            await remoteSessionSql(sessionId, 'ROLLBACK');
          } catch (rollbackError) {
            console.error(JSON.stringify({
              level: 'error',
              msg: 'remote transaction rollback failed',
              session_id: sessionId,
              error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            }));
          }
          throw error;
        }
        throw new Error(`MongrelDB COMMIT outcome is unknown: ${String(error)}`, { cause: error });
      }
    }
    committed = true;
    return result;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await closeRemoteSessionWithRetry(sessionId);
    } catch (closeError) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'remote session close failed',
        session_id: sessionId,
        committed,
        error: closeError instanceof Error ? closeError.message : String(closeError),
      }));
      if (!primaryError && !committed) throw closeError;
    }
  }
}

async function withEmbeddedQueue<T>(fn: () => Promise<T>): Promise<T> {
  const previous = globalState.__rediEmbeddedTransactionTail!;
  let release!: () => void;
  globalState.__rediEmbeddedTransactionTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function withSqlTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (transactionContext.getStore()) return fn();
  const db = await getDb();
  if (db instanceof RemoteDatabase) return inRemoteTransaction(fn);

  // ponytail: one embedded handle has one SQL session; split handles if throughput matters.
  return withEmbeddedQueue(async () => {
    await db.sql('BEGIN');
    try {
      const result = await transactionContext.run({ embedded: true }, fn);
      await db.sql('COMMIT');
      return result;
    } catch (error) {
      try {
        await db.sql('ROLLBACK');
      } catch {
        // Keep the original transaction error.
      }
      throw error;
    }
  });
}

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

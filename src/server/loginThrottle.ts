import { createHash } from 'node:crypto';
import { lit, sqlExec, sqlRows } from './db/sql';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const LOCKOUT_ROW = 'login_lockout:';
const MAX_TRACKED_KEYS = 10_000;
const LOCKOUT_SLOTS = 1024;

const failures = new Map<string, number>();
const lockedUntilMem = new Map<string, number>();

export interface LockState {
  locked: boolean;
  retryAfterSeconds: number;
}

export async function getLoginLockState(key = 'local'): Promise<LockState> {
  const now = Date.now();
  const row = lockoutRow(key);
  const memUntil = lockedUntilMem.get(key) ?? 0;
  if (memUntil > now) return { locked: true, retryAfterSeconds: Math.ceil((memUntil - now) / 1000) };
  lockedUntilMem.delete(key);
  try {
    const rows = await sqlRows<{ locked_until: string; last_status: string }>(
      `SELECT locked_until, last_status FROM job_leases WHERE job_name = ${lit(row)}`,
    );
    const persisted = rows[0]?.last_status === lockStatus(key)
      ? rows[0].locked_until
      : null;
    if (persisted && persisted > new Date(now).toISOString()) {
      return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(persisted) - now) / 1000)) };
    }
  } catch {
    // DB not ready yet: in-memory state still applies.
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export async function recordLoginFailure(key = 'local'): Promise<void> {
  const count = (failures.get(key) ?? 0) + 1;
  if (count < MAX_FAILURES) {
    if (!failures.has(key) && failures.size >= MAX_TRACKED_KEYS) {
      failures.delete(failures.keys().next().value as string);
    }
    failures.set(key, count);
    return;
  }
  failures.delete(key);
  const until = Date.now() + LOCKOUT_MS;
  if (!lockedUntilMem.has(key) && lockedUntilMem.size >= MAX_TRACKED_KEYS) {
    lockedUntilMem.delete(lockedUntilMem.keys().next().value as string);
  }
  lockedUntilMem.set(key, until);
  try {
    const row = lockoutRow(key);
    const nowIso = new Date().toISOString();
    const untilIso = new Date(until).toISOString();
    const rows = await sqlRows<{ job_name: string }>(
      `SELECT job_name FROM job_leases WHERE job_name = ${lit(row)}`,
    );
    const status = lockStatus(key);
    if (rows.length === 0) {
      await sqlExec(
        `INSERT INTO job_leases (job_name, locked_until, last_run_at, last_status) VALUES (` +
        `${lit(row)}, ${lit(untilIso)}, ${lit(nowIso)}, ${lit(status)})`,
      );
    } else {
      await sqlExec(
        `UPDATE job_leases SET locked_until = ${lit(untilIso)}, ` +
        `last_run_at = ${lit(nowIso)}, last_status = ${lit(status)} ` +
        `WHERE job_name = ${lit(row)}`,
      );
    }
  } catch {
    // Persistence best-effort. In-memory lockout still applies.
  }
}

export async function recordLoginSuccess(key = 'local'): Promise<void> {
  failures.delete(key);
  lockedUntilMem.delete(key);
  try {
    await sqlExec(
      `UPDATE job_leases SET locked_until = ${lit(new Date())}, last_status = 'cleared' ` +
      `WHERE job_name = ${lit(lockoutRow(key))} AND last_status = ${lit(lockStatus(key))}`,
    );
  } catch {
    // A correct credential must still succeed while the DB is unavailable.
  }
}

export function _resetLoginThrottleForTests(): void {
  failures.clear();
  lockedUntilMem.clear();
}

export function _loginThrottleEntryCountForTests(): number {
  return failures.size + lockedUntilMem.size;
}

function lockoutRow(key: string): string {
  // ponytail: bounded shared slots cap persistence; collisions keep only in-memory isolation.
  const digest = createHash('sha256').update(key).digest();
  return LOCKOUT_ROW + String(digest.readUInt16BE(0) % LOCKOUT_SLOTS);
}

function lockStatus(key: string): string {
  return `locked:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

export function _loginThrottleRowForTests(key: string): string {
  return lockoutRow(key);
}

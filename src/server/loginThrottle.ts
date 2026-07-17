import { createHash } from 'node:crypto';
import { lit, sqlExec, sqlRows } from './db/sql';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const LOCKOUT_ROW = 'login_lockout:';

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
  try {
    const rows = await sqlRows<{ locked_until: string }>(
      `SELECT locked_until FROM job_leases WHERE job_name = ${lit(row)}`,
    );
    const persisted = rows[0]?.locked_until;
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
    failures.set(key, count);
    return;
  }
  failures.delete(key);
  const until = Date.now() + LOCKOUT_MS;
  lockedUntilMem.set(key, until);
  try {
    const row = lockoutRow(key);
    const nowIso = new Date().toISOString();
    const untilIso = new Date(until).toISOString();
    const rows = await sqlRows<{ job_name: string }>(
      `SELECT job_name FROM job_leases WHERE job_name = ${lit(row)}`,
    );
    if (rows.length === 0) {
      await sqlExec(
        `INSERT INTO job_leases (job_name, locked_until, last_run_at, last_status) VALUES (` +
        `${lit(row)}, ${lit(untilIso)}, ${lit(nowIso)}, 'locked')`,
      );
    } else {
      await sqlExec(
        `UPDATE job_leases SET locked_until = ${lit(untilIso)}, ` +
        `last_run_at = ${lit(nowIso)}, last_status = 'locked' ` +
        `WHERE job_name = ${lit(row)}`,
      );
    }
  } catch {
    // Persistence best-effort. In-memory lockout still applies.
  }
}

export function recordLoginSuccess(key = 'local'): void {
  failures.delete(key);
  lockedUntilMem.delete(key);
}

export function _resetLoginThrottleForTests(): void {
  failures.clear();
  lockedUntilMem.clear();
}

function lockoutRow(key: string): string {
  return LOCKOUT_ROW + createHash('sha256').update(key).digest('hex').slice(0, 32);
}

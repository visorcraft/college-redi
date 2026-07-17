import { eq } from '@visorcraft/mongreldb-kit';
import { getKitDb } from './db/client';
import { jobLeases } from '../../db/schema';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const LOCKOUT_ROW = 'login_lockout';

const failures = new Map<string, number>();
const lockedUntilMem = new Map<string, number>();

export interface LockState {
  locked: boolean;
  retryAfterSeconds: number;
}

export async function getLoginLockState(key = 'local'): Promise<LockState> {
  const now = Date.now();
  const memUntil = lockedUntilMem.get(key) ?? 0;
  if (memUntil > now) return { locked: true, retryAfterSeconds: Math.ceil((memUntil - now) / 1000) };
  try {
    const db = await getKitDb();
    const rows = db.selectFrom(jobLeases).where(eq(jobLeases.job_name, LOCKOUT_ROW)).executeSync();
    const persisted = rows[0]?.locked_until as string | undefined;
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
    const db = await getKitDb();
    const nowIso = new Date().toISOString();
    const untilIso = new Date(until).toISOString();
    const rows = db.selectFrom(jobLeases).where(eq(jobLeases.job_name, LOCKOUT_ROW)).executeSync();
    if (rows.length === 0) {
      db.insertInto(jobLeases).values({ job_name: LOCKOUT_ROW, locked_until: untilIso, last_run_at: nowIso, last_status: 'locked' }).executeSync();
    } else {
      db.updateTable(jobLeases).set({ locked_until: untilIso, last_run_at: nowIso, last_status: 'locked' }).where(eq(jobLeases.job_name, LOCKOUT_ROW)).executeSync();
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

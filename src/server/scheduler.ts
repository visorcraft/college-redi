import cron, { type ScheduledTask } from 'node-cron';
import { eq, lt } from '@visorcraft/mongreldb-kit';
import { getKitDb } from './db/client';
import { jobLeases } from '../../db/schema';

const tasks: ScheduledTask[] = [];
let alive = false;

export function isSchedulerAlive(): boolean {
  return alive;
}

export async function startScheduler(): Promise<void> {
  if (alive) return;
  alive = true;
  // Hourly stale-lease cleanup (Appendix C). Overlap-safe: sweep is idempotent.
  tasks.push(
    cron.schedule('0 * * * *', () => {
      void sweepExpiredLeases().catch((err) =>
        console.error(JSON.stringify({ level: 'error', msg: 'stale-lease sweep failed', error: String(err) })),
      );
    }),
  );
  console.log(JSON.stringify({ level: 'info', msg: 'scheduler started', jobs: tasks.length }));
}

export function stopScheduler(): void {
  for (const t of tasks.splice(0)) t.stop();
  alive = false;
}

/** Returns true when the lease was acquired; false when another run still holds it. */
export async function acquireJobLease(jobName: string, ttlMs: number): Promise<boolean> {
  const db = await getKitDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const rows = db.selectFrom(jobLeases).where(eq(jobLeases.job_name, jobName)).executeSync();
  const existing = rows[0];
  // A lease past its locked_until is stale and may be taken over (spec §13 job overrun).
  if (existing && (existing.locked_until as string) > nowIso) return false;
  const lockedUntil = new Date(now.getTime() + ttlMs).toISOString();
  if (existing) {
    db.updateTable(jobLeases)
      .set({ locked_until: lockedUntil, last_run_at: nowIso, last_status: 'running' })
      .where(eq(jobLeases.job_name, jobName))
      .executeSync();
  } else {
    db.insertInto(jobLeases)
      .values({ job_name: jobName, locked_until: lockedUntil, last_run_at: nowIso, last_status: 'running' })
      .executeSync();
  }
  return true;
}

export async function releaseJobLease(jobName: string, status: 'ok' | 'failed'): Promise<void> {
  const db = await getKitDb();
  const nowIso = new Date().toISOString();
  const rows = db.selectFrom(jobLeases).where(eq(jobLeases.job_name, jobName)).executeSync();
  if (rows.length === 0) {
    db.insertInto(jobLeases)
      .values({ job_name: jobName, locked_until: nowIso, last_run_at: nowIso, last_status: status })
      .executeSync();
    return;
  }
  // locked_until = now makes the job immediately re-acquirable.
  db.updateTable(jobLeases)
    .set({ locked_until: nowIso, last_status: status })
    .where(eq(jobLeases.job_name, jobName))
    .executeSync();
}

const STALE_LEASE_MS = 24 * 60 * 60 * 1000; // locked_until + 1 day (spec §7.6)

export async function sweepExpiredLeases(): Promise<number> {
  const db = await getKitDb();
  const cutoff = new Date(Date.now() - STALE_LEASE_MS).toISOString();
  return Number(db.deleteFrom(jobLeases).where(lt(jobLeases.locked_until, cutoff)).executeSync());
}

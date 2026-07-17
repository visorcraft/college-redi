import cron, { type ScheduledTask } from 'node-cron';
import { eq, lt } from '@visorcraft/mongreldb-kit';
import { getKitDb } from './db/client';
import { jobLeases } from '../../db/schema';
import { getSettings } from './settings';
import { lit, sqlExec, sqlRows } from './db/sql';
import { runDailyDigestJob, runNotificationDispatchJob, runRegistrationSweepJob } from './notify/jobs';
import type { EngineSettings } from './notify/engine';

const tasks: ScheduledTask[] = [];
let alive = false;

export function isSchedulerAlive(): boolean {
  return alive;
}

export async function startScheduler(): Promise<void> {
  if (alive) return;
  alive = true;
  if (process.env.SCHEDULER_ENABLED === 'false') return;
  tasks.push(
    cron.schedule('* * * * *', () => {
      void withLease('notification_dispatch', 55_000, () => runNotificationDispatchJob());
    }),
    cron.schedule('7 * * * *', () => {
      void withLease('registration_sweep', 10 * 60_000, () => runRegistrationSweepJob());
    }),
  );
  const settings = (await getSettings()) as unknown as EngineSettings;
  const configured = settings.notification_prefs?.digest_time ?? '';
  const digestTime = /^\d{2}:\d{2}$/.test(configured) ? configured : '08:00';
  const [h, m] = digestTime.split(':').map(Number);
  tasks.push(
    cron.schedule(`${m} ${h} * * *`, () => {
      void withLease('daily_digest', 10 * 60_000, () => runDailyDigestJob());
    }, { timezone: settings.timezone ?? 'UTC' }),
  );
}

export function stopScheduler(): void {
  for (const t of tasks.splice(0)) t.stop();
  alive = false;
}

export async function withLease(
  jobName: string,
  leaseMs: number,
  fn: () => Promise<unknown>,
): Promise<{ skipped: boolean }> {
  const now = new Date();
  const existing = (await sqlRows<{ locked_until: string | null }>(
    `SELECT locked_until FROM job_leases WHERE job_name = ${lit(jobName)}`,
  ))[0];
  if (existing?.locked_until && new Date(existing.locked_until) > now) return { skipped: true };
  const until = new Date(now.getTime() + leaseMs);
  if (!existing) {
    await sqlExec(`INSERT INTO job_leases (job_name, locked_until, last_run_at, last_status) VALUES (${lit(jobName)}, ${lit(until)}, ${lit(now)}, 'running')`);
  } else {
    await sqlExec(`UPDATE job_leases SET locked_until = ${lit(until)}, last_run_at = ${lit(now)}, last_status = 'running' WHERE job_name = ${lit(jobName)}`);
  }
  try {
    await fn();
    await sqlExec(`UPDATE job_leases SET last_status = 'ok' WHERE job_name = ${lit(jobName)}`);
  } catch (err) {
    await sqlExec(`UPDATE job_leases SET last_status = 'error' WHERE job_name = ${lit(jobName)}`);
    console.error(`[scheduler] job "${jobName}" failed`, err);
  }
  return { skipped: false };
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

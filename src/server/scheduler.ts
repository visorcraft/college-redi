import { randomUUID } from 'node:crypto';
import cron, { type ScheduledTask } from 'node-cron';
import { getSettings } from './settings';
import { lit, sqlExec, sqlRows } from './db/sql';
import { runDailyDigestJob, runNotificationDispatchJob, runRegistrationSweepJob } from './notify/jobs';
import type { EngineSettings } from './notify/engine';

const tasks: ScheduledTask[] = [];
let alive = false;
let leaseTail: Promise<void> = Promise.resolve();

export function isSchedulerAlive(): boolean {
  return alive;
}

export async function startScheduler(): Promise<void> {
  if (alive) return;
  if (process.env.SCHEDULER_ENABLED === 'false') return;
  alive = true;
  tasks.push(
    cron.schedule('* * * * *', () => {
      void withLease('notification_dispatch', 55_000, () => runNotificationDispatchJob());
    }),
    cron.schedule('7 * * * *', () => {
      void withLease('registration_sweep', 10 * 60_000, () => runRegistrationSweepJob());
    }),
    cron.schedule('* * * * *', () => {
      void runDailyDigestIfDue();
    }),
    cron.schedule('17 * * * *', () => {
      void sweepExpiredLeases().catch((error) => console.error(JSON.stringify({
        level: 'error',
        msg: 'stale-lease sweep failed',
        error: error instanceof Error ? error.message : String(error),
      })));
    }),
  );
}

export function stopScheduler(): void {
  for (const t of tasks.splice(0)) t.stop();
  alive = false;
}

async function claimJobLeaseUnlocked(
  jobName: string,
  ttlMs: number,
  now = new Date(),
): Promise<string | null> {
  const nowIso = now.toISOString();
  const lockedUntil = new Date(now.getTime() + ttlMs).toISOString();
  const owner = `running:${randomUUID()}`;
  await sqlExec(
    `UPDATE job_leases SET locked_until = ${lit(lockedUntil)}, ` +
    `last_run_at = ${lit(nowIso)}, last_status = ${lit(owner)} ` +
    `WHERE job_name = ${lit(jobName)} AND (` +
    `locked_until IS NULL OR locked_until <= ${lit(nowIso)})`,
  );
  const current = (await sqlRows<{ last_status: string }>(
    `SELECT last_status FROM job_leases WHERE job_name = ${lit(jobName)}`,
  ))[0];
  if (current?.last_status === owner) return owner;
  if (current) return null;
  try {
    await sqlExec(
      `INSERT INTO job_leases (job_name, locked_until, last_run_at, last_status) VALUES (` +
      `${lit(jobName)}, ${lit(lockedUntil)}, ${lit(nowIso)}, ${lit(owner)})`,
    );
    return owner;
  } catch (error) {
    const raced = (await sqlRows<{ job_name: string }>(
      `SELECT job_name FROM job_leases WHERE job_name = ${lit(jobName)}`,
    ))[0];
    if (raced) return null;
    throw error;
  }
}

export function acquireJobLeaseToken(
  jobName: string,
  ttlMs: number,
  now = new Date(),
): Promise<string | null> {
  const pending = leaseTail.then(() =>
    claimJobLeaseUnlocked(jobName, ttlMs, now));
  leaseTail = pending.then(() => undefined, () => undefined);
  return pending;
}

export async function withLease<T>(
  jobName: string,
  leaseMs: number,
  fn: () => Promise<T>,
): Promise<{ skipped: true } | { skipped: false; result?: T }> {
  const owner = await acquireJobLeaseToken(jobName, leaseMs);
  if (!owner) return { skipped: true };
  try {
    const result = await fn();
    await sqlExec(
      `UPDATE job_leases SET last_status = 'ok' ` +
      `WHERE job_name = ${lit(jobName)} AND last_status = ${lit(owner)}`,
    );
    return { skipped: false, result };
  } catch (err) {
    await sqlExec(
      `UPDATE job_leases SET last_status = 'error' ` +
      `WHERE job_name = ${lit(jobName)} AND last_status = ${lit(owner)}`,
    );
    console.error(JSON.stringify({
      level: 'error',
      msg: 'scheduler job failed',
      job: jobName,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    return { skipped: false };
  }
}

/** Returns true when the lease was acquired; false when another run still holds it. */
export async function acquireJobLease(
  jobName: string,
  ttlMs: number,
  now = new Date(),
): Promise<boolean> {
  return (await acquireJobLeaseToken(jobName, ttlMs, now)) !== null;
}

function localDateTime(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

export async function runDailyDigestIfDue(now = new Date()) {
  const settings = (await getSettings()) as unknown as EngineSettings;
  const configured = settings.notification_prefs?.digest_time ?? '08:00';
  const target = /^\d{2}:\d{2}$/.test(configured) ? configured : '08:00';
  const local = localDateTime(now, settings.timezone ?? 'UTC');
  if (local.time !== target) return { skipped: true as const };
  return withLease(
    `daily_digest:${local.date}`,
    26 * 60 * 60_000,
    () => runDailyDigestJob(now),
  );
}

export async function releaseJobLease(
  jobName: string,
  status: 'ok' | 'error' | 'failed',
  now = new Date(),
  owner?: string,
): Promise<void> {
  const nowIso = now.toISOString();
  if (owner) {
    await sqlExec(
      `UPDATE job_leases SET locked_until = ${lit(nowIso)}, ` +
      `last_status = ${lit(status)} WHERE job_name = ${lit(jobName)} ` +
      `AND last_status = ${lit(owner)}`,
    );
    return;
  }
  const rows = await sqlRows<{ job_name: string }>(
    `SELECT job_name FROM job_leases WHERE job_name = ${lit(jobName)}`,
  );
  if (rows.length === 0) {
    await sqlExec(
      `INSERT INTO job_leases (job_name, locked_until, last_run_at, last_status) VALUES (` +
      `${lit(jobName)}, ${lit(nowIso)}, ${lit(nowIso)}, ${lit(status)})`,
    );
    return;
  }
  // locked_until = now makes the job immediately re-acquirable.
  await sqlExec(
    `UPDATE job_leases SET locked_until = ${lit(nowIso)}, ` +
    `last_status = ${lit(status)} WHERE job_name = ${lit(jobName)}`,
  );
}

const STALE_LEASE_MS = 24 * 60 * 60 * 1000; // locked_until + 1 day (spec §7.6)

export async function sweepExpiredLeases(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LEASE_MS).toISOString();
  const rows = await sqlRows<{ job_name: string }>(
    `SELECT job_name FROM job_leases WHERE locked_until < ${lit(cutoff)}`,
  );
  if (rows.length > 0) {
    await sqlExec(
      `DELETE FROM job_leases WHERE locked_until < ${lit(cutoff)}`,
    );
  }
  return rows.length;
}

import { eq } from '@visorcraft/mongreldb-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';
import {
  acquireJobLease, isSchedulerAlive, releaseJobLease, startScheduler, stopScheduler, sweepExpiredLeases,
} from '@/server/scheduler';
import { getKitDb } from '@/server/db/client';
import { jobLeases } from '../../db/schema';

let env: TestEnv;
beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
  stopScheduler();
});
afterEach(() => {
  stopScheduler();
  env.cleanup();
});

describe('job leases', () => {
  it('grants one lease per job and blocks overlap until expiry', async () => {
    expect(await acquireJobLease('imap_poll', 60_000)).toBe(true);
    expect(await acquireJobLease('imap_poll', 60_000)).toBe(false);
    expect(await acquireJobLease('other_job', 60_000)).toBe(true);
  });

  it('allows re-acquire after release, and after the lease expires', async () => {
    expect(await acquireJobLease('digest', 60_000)).toBe(true);
    await releaseJobLease('digest', 'ok');
    expect(await acquireJobLease('digest', 60_000)).toBe(true);
    const db = await getKitDb();
    const past = new Date(Date.now() - 60_000).toISOString();
    db.updateTable(jobLeases).set({ locked_until: past }).where(eq(jobLeases.job_name, 'digest')).executeSync();
    expect(await acquireJobLease('digest', 60_000)).toBe(true);
  });

  it('sweeps only leases expired for more than a day', async () => {
    const db = await getKitDb();
    const now = Date.now();
    const old = new Date(now - 25 * 3600 * 1000).toISOString();
    const fresh = new Date(now - 1000).toISOString();
    db.insertInto(jobLeases)
      .valuesMany([
        { job_name: 'old', locked_until: old, last_run_at: old, last_status: 'ok' },
        { job_name: 'fresh', locked_until: fresh, last_run_at: fresh, last_status: 'running' },
      ])
      .executeSync();
    expect(await sweepExpiredLeases()).toBe(1);
    expect(db.selectFrom(jobLeases).executeSync().map((r) => r.job_name)).toEqual(['fresh']);
  });
});

describe('scheduler lifecycle', () => {
  it('starts (idempotently) and stops', async () => {
    expect(isSchedulerAlive()).toBe(false);
    await startScheduler();
    await startScheduler();
    expect(isSchedulerAlive()).toBe(true);
    stopScheduler();
    expect(isSchedulerAlive()).toBe(false);
  });
});

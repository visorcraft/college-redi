import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshEmailTestDb } from '../helpers/emailTestDb';

vi.mock('../../src/server/email/pipeline', () => ({
  runEmailPipeline: vi.fn(async () => ({
    configured: true,
    fetched: 0,
    skipped: 0,
    junk: 0,
    informational: 0,
    actionable: 0,
    unprocessed: 0,
    summaries: [],
  })),
}));

let job: typeof import('../../src/server/email/imapJob');
let store: typeof import('../../src/server/email/store');
let settings: typeof import('../../src/server/settings');
let runEmailPipeline: ReturnType<typeof vi.fn>;
const NOW = new Date('2026-07-17T12:00:00Z');

beforeAll(async () => {
  await freshEmailTestDb();
  job = await import('../../src/server/email/imapJob');
  store = await import('../../src/server/email/store');
  settings = await import('../../src/server/settings');
  ({ runEmailPipeline } = await import('../../src/server/email/pipeline') as unknown as {
    runEmailPipeline: ReturnType<typeof vi.fn>;
  });
});

beforeEach(async () => {
  runEmailPipeline.mockReset();
  runEmailPipeline.mockResolvedValue({});
  await settings.updateSettings({
    imap: {
      host: 'imap.stateu.edu',
      port: 993,
      tls: true,
      username: 'a@b.edu',
      mailbox: 'INBOX',
      poll_interval_minutes: 5,
      enabled: true,
      auto_accept_events: true,
      last_uid: 0,
      uidvalidity: null,
      last_poll_at: null,
      last_error: null,
      backoff_step: 0,
      next_poll_after: null,
    },
  });
  await store.upsertJobLease({
    job_name: job.IMAP_POLL_JOB,
    locked_until: NOW.toISOString(),
    last_run_at: NOW.toISOString(),
    last_status: 'ok',
  });
});

describe('runImapPollJob', () => {
  it('skips when unconfigured', async () => {
    await settings.updateSettings({ imap: { enabled: false } });
    expect(await job.runImapPollJob(NOW)).toEqual({ ran: false, reason: 'unconfigured' });
    expect(runEmailPipeline).not.toHaveBeenCalled();
  });

  it('runs when due and records an ok lease', async () => {
    expect((await job.runImapPollJob(NOW)).ran).toBe(true);
    expect(runEmailPipeline).toHaveBeenCalledWith({ actor: 'system' });
    expect((await store.getJobLease(job.IMAP_POLL_JOB))?.last_status).toBe('ok');
  });

  it('skips when the poll interval is not due', async () => {
    await settings.updateSettings({
      imap: { last_poll_at: new Date(NOW.getTime() - 2 * 60_000).toISOString() },
    });
    expect(await job.runImapPollJob(NOW)).toEqual({ ran: false, reason: 'not_due' });
  });

  it('skips while another runner owns the lease', async () => {
    await store.upsertJobLease({
      job_name: job.IMAP_POLL_JOB,
      locked_until: new Date(NOW.getTime() + 60_000).toISOString(),
      last_run_at: NOW.toISOString(),
      last_status: 'running',
    });
    expect(await job.runImapPollJob(NOW)).toEqual({ ran: false, reason: 'lease' });
  });

  it('breaks a stale lease and runs', async () => {
    await store.upsertJobLease({
      job_name: job.IMAP_POLL_JOB,
      locked_until: new Date(NOW.getTime() - 60_000).toISOString(),
      last_run_at: NOW.toISOString(),
      last_status: 'running',
    });
    expect((await job.runImapPollJob(NOW)).ran).toBe(true);
  });

  it('backs off 5m then 10m on failures', async () => {
    runEmailPipeline.mockRejectedValue(new Error('IMAP auth failed'));
    expect(await job.runImapPollJob(NOW)).toMatchObject({
      ran: true,
      error: 'IMAP auth failed',
    });
    let imap = (await settings.getSettings()).imap;
    expect(imap.last_error).toBe('IMAP auth failed');
    expect(imap.backoff_step).toBe(1);
    expect(imap.next_poll_after).toBe(new Date(NOW.getTime() + 5 * 60_000).toISOString());
    expect((await store.getJobLease(job.IMAP_POLL_JOB))?.last_status).toBe('error');
    expect(await job.runImapPollJob(new Date(NOW.getTime() + 3 * 60_000))).toEqual({
      ran: false,
      reason: 'backoff',
    });
    const retryAt = new Date(NOW.getTime() + 6 * 60_000);
    expect((await job.runImapPollJob(retryAt)).ran).toBe(true);
    imap = (await settings.getSettings()).imap;
    expect(imap.backoff_step).toBe(2);
    expect(imap.next_poll_after).toBe(
      new Date(retryAt.getTime() + 10 * 60_000).toISOString(),
    );
  });

  it('caps backoff at 60m', async () => {
    runEmailPipeline.mockRejectedValue(new Error('down'));
    await settings.updateSettings({ imap: { backoff_step: 3 } });
    await job.runImapPollJob(NOW);
    const imap = (await settings.getSettings()).imap;
    expect(imap.backoff_step).toBe(3);
    expect(imap.next_poll_after).toBe(new Date(NOW.getTime() + 60 * 60_000).toISOString());
  });
});

describe('clampPollInterval', () => {
  it('clamps to 1..60 with default 5', () => {
    expect(job.clampPollInterval(undefined)).toBe(5);
    expect(job.clampPollInterval(0)).toBe(1);
    expect(job.clampPollInterval(500)).toBe(60);
    expect(job.clampPollInterval(15)).toBe(15);
  });
});

import cron from 'node-cron';
import { getSettings, updateSettings } from '../settings';
import { runEmailPipeline } from './pipeline';
import { getJobLease, upsertJobLease } from './store';

export const IMAP_POLL_JOB = 'imap_poll';
export const BACKOFF_MINUTES = [5, 10, 30, 60] as const;

export function clampPollInterval(minutes: unknown): number {
  const value = Math.round(Number(minutes ?? 5));
  return Math.min(60, Math.max(1, Number.isFinite(value) ? value : 5));
}

export interface ImapJobOutcome {
  ran: boolean;
  reason?: 'unconfigured' | 'backoff' | 'not_due' | 'lease';
  error?: string;
}

type ImapSettings = Awaited<ReturnType<typeof getSettings>>['imap'];

async function patchImap(patch: Partial<ImapSettings>): Promise<void> {
  const current = (await getSettings()).imap;
  await updateSettings({ imap: { ...current, ...patch } });
}

export async function runImapPollJob(now: Date = new Date()): Promise<ImapJobOutcome> {
  const imap = (await getSettings()).imap;
  if (!imap.enabled || !imap.host) return { ran: false, reason: 'unconfigured' };
  const intervalMinutes = clampPollInterval(imap.poll_interval_minutes);
  if (imap.next_poll_after && new Date(imap.next_poll_after) > now) {
    return { ran: false, reason: 'backoff' };
  }
  if (imap.last_poll_at
    && new Date(imap.last_poll_at).getTime() + intervalMinutes * 60_000 > now.getTime()) {
    return { ran: false, reason: 'not_due' };
  }
  const lease = await getJobLease(IMAP_POLL_JOB);
  if (lease?.locked_until && new Date(lease.locked_until) > now) {
    return { ran: false, reason: 'lease' };
  }
  await upsertJobLease({
    job_name: IMAP_POLL_JOB,
    locked_until: new Date(now.getTime() + 2 * intervalMinutes * 60_000).toISOString(),
    last_run_at: now.toISOString(),
    last_status: 'running',
  });
  try {
    await runEmailPipeline({ actor: 'system' });
    await upsertJobLease({
      job_name: IMAP_POLL_JOB,
      locked_until: now.toISOString(),
      last_run_at: now.toISOString(),
      last_status: 'ok',
    });
    return { ran: true };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    const step = Math.min(imap.backoff_step ?? 0, BACKOFF_MINUTES.length - 1);
    const delayMinutes = BACKOFF_MINUTES[step];
    await patchImap({
      last_poll_at: now.toISOString(),
      last_error: message,
      backoff_step: Math.min(step + 1, BACKOFF_MINUTES.length - 1),
      next_poll_after: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
    });
    await upsertJobLease({
      job_name: IMAP_POLL_JOB,
      locked_until: now.toISOString(),
      last_run_at: now.toISOString(),
      last_status: 'error',
    });
    console.warn(JSON.stringify({
      level: 'warn',
      job: IMAP_POLL_JOB,
      msg: 'IMAP poll failed',
      retry_in_min: delayMinutes,
      error: message,
    }));
    return { ran: true, error: message };
  }
}

export function startImapPollSchedule(): void {
  if (process.env.SCHEDULER_ENABLED === 'false') return;
  cron.schedule('* * * * *', () => {
    void runImapPollJob().catch((error) => console.error(JSON.stringify({
      level: 'error',
      job: IMAP_POLL_JOB,
      msg: 'uncaught job exception',
      error: String(error instanceof Error ? error.stack : error),
    })));
  });
}

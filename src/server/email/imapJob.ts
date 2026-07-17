import cron from 'node-cron';
import { getSettings, updateSettings } from '../settings';
import {
  acquireJobLeaseToken,
  keepJobLeaseAlive,
  releaseJobLease,
} from '../scheduler';
import { runEmailPipeline } from './pipeline';
import type { PipelineResult } from './pipeline';

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
  result?: PipelineResult;
}

type ImapSettings = Awaited<ReturnType<typeof getSettings>>['imap'];
export interface ImapPollOptions {
  force?: boolean;
  actor?: string;
}

async function patchImap(patch: Partial<ImapSettings>): Promise<void> {
  await updateSettings({ imap: patch });
}

export async function runImapPollJob(
  now: Date = new Date(),
  options: ImapPollOptions = {},
): Promise<ImapJobOutcome> {
  const imap = (await getSettings()).imap;
  if (!imap.enabled || !imap.host) return { ran: false, reason: 'unconfigured' };
  const intervalMinutes = clampPollInterval(imap.poll_interval_minutes);
  if (!options.force && imap.next_poll_after && new Date(imap.next_poll_after) > now) {
    return { ran: false, reason: 'backoff' };
  }
  if (!options.force && imap.last_poll_at
    && new Date(imap.last_poll_at).getTime() + intervalMinutes * 60_000 > now.getTime()) {
    return { ran: false, reason: 'not_due' };
  }
  const leaseOwner = await acquireJobLeaseToken(
    IMAP_POLL_JOB,
    2 * intervalMinutes * 60_000,
    now,
  );
  if (!leaseOwner) {
    return { ran: false, reason: 'lease' };
  }
  const stopHeartbeat = keepJobLeaseAlive(
    IMAP_POLL_JOB,
    leaseOwner,
    2 * intervalMinutes * 60_000,
  );
  try {
    const result = await runEmailPipeline({ actor: options.actor ?? 'system' });
    await releaseJobLease(IMAP_POLL_JOB, 'ok', now, leaseOwner);
    return { ran: true, result };
  } catch (error) {
    const failedAt = new Date();
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    const step = Math.min(imap.backoff_step ?? 0, BACKOFF_MINUTES.length - 1);
    const delayMinutes = BACKOFF_MINUTES[step];
    await patchImap({
      last_poll_at: failedAt.toISOString(),
      last_error: message,
      backoff_step: Math.min(step + 1, BACKOFF_MINUTES.length - 1),
      next_poll_after: new Date(failedAt.getTime() + delayMinutes * 60_000).toISOString(),
    });
    await releaseJobLease(IMAP_POLL_JOB, 'error', failedAt, leaseOwner);
    console.warn(JSON.stringify({
      level: 'warn',
      job: IMAP_POLL_JOB,
      msg: 'IMAP poll failed',
      retry_in_min: delayMinutes,
      error: message,
    }));
    return { ran: true, error: message };
  } finally {
    stopHeartbeat();
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

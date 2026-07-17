import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '../../../../server/password';
import { getSecret } from '../../../../server/secrets';
import { runNotificationDispatchJob } from '../../../../server/notify/jobs';
import { runImapPollJob } from '../../../../server/email/imapJob';
import { withLease } from '../../../../server/scheduler';
import { runAudited } from '../../../../server/tools/call';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-redi-cron-secret');
  const stored = await getSecret('cron.secret_hash');
  const configured = process.env.CRON_SECRET;
  const sameLength = secret && configured
    ? Buffer.byteLength(secret) === Buffer.byteLength(configured)
    : false;
  const fromEnv = sameLength
    ? timingSafeEqual(Buffer.from(secret!), Buffer.from(configured!))
    : false;
  const valid = fromEnv
    || Boolean(secret && stored && await verifyPassword(stored, secret));
  if (!valid) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'invalid cron secret' } },
      { status: 401 },
    );
  }
  try {
    return await runAudited('cron', 'cron_tick', async () => {
      const dispatch = await withLease(
        'notification_dispatch',
        55_000,
        (signal) => runNotificationDispatchJob(new Date(), signal),
      );
      const imapPoll = await runImapPollJob(new Date());
      if ('error' in dispatch) throw new Error(`notification dispatch failed: ${dispatch.error}`);
      if (imapPoll.error) throw new Error(`IMAP poll failed: ${imapPoll.error}`);
      const summary = dispatch.skipped ? null : dispatch.result;
      return NextResponse.json({
        ok: true,
        ran: dispatch.skipped ? [] : ['notification_dispatch'],
        skipped: dispatch.skipped,
        ...(summary ?? {
          due: 0,
          sent: 0,
          failed: 0,
          awaiting_retry: 0,
          held: 0,
          reminders_enqueued: 0,
        }),
        imapPoll,
      });
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

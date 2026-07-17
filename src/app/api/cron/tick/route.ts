import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '../../../../server/password';
import { getSecret } from '../../../../server/secrets';
import { runNotificationDispatchJob } from '../../../../server/notify/jobs';
import { runImapPollJob } from '../../../../server/email/imapJob';

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
  const summary = await runNotificationDispatchJob();
  const imapPoll = await runImapPollJob(new Date());
  return NextResponse.json({
    ok: true,
    ran: ['notification_dispatch'],
    ...summary,
    imapPoll,
  });
}

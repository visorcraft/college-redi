import { ensureBootstrapped } from './server/bootstrap';
import { installDbShutdownHandler } from './server/db/client';
import { startImapPollSchedule } from './server/email/imapJob';

export async function register(): Promise<void> {
  installDbShutdownHandler();
  await ensureBootstrapped();
  startImapPollSchedule();
}

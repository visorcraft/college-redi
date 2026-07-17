import { ensureBootstrapped } from './server/bootstrap';
import { startImapPollSchedule } from './server/email/imapJob';

export async function register(): Promise<void> {
  await ensureBootstrapped();
  startImapPollSchedule();
}

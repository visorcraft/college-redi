import twilio from 'twilio';
import { getSettings } from '../settings';
import { getSecret } from '../secrets';
import type { EngineSettings } from './engine';

export async function sendTwilioSms(input: { to: string; body: string }): Promise<{ sid: string }> {
  const t = ((await getSettings()) as unknown as EngineSettings).twilio;
  if (!t?.enabled || !t.account_sid) throw new Error('twilio not configured');
  if (!t.from_number || !t.to_number) throw new Error('twilio numbers not configured');
  const authToken = await getSecret('twilio.auth_token');
  const msg = await twilio(t.account_sid, authToken ?? '', {
    timeout: 120_000,
  }).messages.create({
    from: t.from_number,
    to: input.to,
    body: input.body,
  });
  return { sid: String(msg.sid) };
}

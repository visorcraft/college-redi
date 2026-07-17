import nodemailer from 'nodemailer';
import { getSettings } from '../settings';
import { getSecret } from '../secrets';
import type { EngineSettings } from './engine';

export async function sendSmtpMail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ messageId: string }> {
  const smtp = ((await getSettings()) as unknown as EngineSettings).smtp;
  if (!smtp?.enabled || !smtp.host) throw new Error('smtp not configured');
  const password = await getSecret('smtp.password');
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port ?? 465,
    secure: (smtp.security ?? 'tls') === 'tls',
    requireTLS: smtp.security === 'starttls',
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 120_000,
    auth: smtp.username ? { user: smtp.username, pass: password ?? '' } : undefined,
  });
  const info = await transporter.sendMail({
    from: smtp.from_address ?? smtp.username,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  return { messageId: String(info.messageId ?? '') };
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import twilio from 'twilio';
import { getSettings } from '../settings';
import { getSecret } from '../secrets';
import { getDb } from '../db/client';
import { getAiClient, AiNotConfiguredError } from '../ai/client';

type Ctx = { actor: string };
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

const EMPTY_JSON_SCHEMA = { type: 'object', properties: {}, additionalProperties: false } as const;

const testAiConnection = {
  name: 'test_ai_connection',
  description:
    'Ping the configured AI provider with a trivial completion and verify tool-calling support. Returns model, latency, and whether the model can call tools (Redi chat is degraded to Q&A without it).',
  sideEffect: 'write' as const,
  paramsSchema: z.object({}).strict(),
  jsonSchema: EMPTY_JSON_SCHEMA,
  async handler() {
    let client; let model;
    try {
      ({ client, model } = await getAiClient());
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        return { ok: false, error: 'not_configured', message: 'Add your AI base URL, API key, and model first (Settings → AI).' };
      }
      throw err;
    }
    const started = Date.now();
    const pingTool = {
      type: 'function' as const,
      function: {
        name: 'redi_ping',
        description: 'No-op used only to verify tool-calling support.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    };
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'Call the redi_ping function.' }],
        tools: [pingTool],
        tool_choice: { type: 'function', function: { name: 'redi_ping' } },
        max_completion_tokens: 32,
      });
      const toolCalling = Boolean(res.choices?.[0]?.message?.tool_calls?.length);
      return {
        ok: true, model, latency_ms: Date.now() - started, tool_calling: toolCalling,
        ...(toolCalling ? {} : { warning: 'The model answered but did not call tools; Redi chat may be limited to Q&A.' }),
      };
    } catch {
      try {
        await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'Reply with the word: ok' }],
          max_completion_tokens: 16,
        });
        return {
          ok: true, model, latency_ms: Date.now() - started, tool_calling: false,
          warning: 'This endpoint/model rejected tool calling. Redi chat will answer questions but cannot take actions until you pick a tool-capable model.',
        };
      } catch (err2) {
        return { ok: false, error: 'request_failed', message: errMsg(err2) };
      }
    }
  },
};

async function requireSecret(name: string, hint: string) {
  const value = await getSecret(name);
  if (!value) return { error: { ok: false as const, error: 'missing_secret', message: hint }, value: null };
  return { error: null, value };
}

async function sendSmtpMail(subject: string, text: string) {
  const settings = await getSettings();
  const smtp = settings.smtp;
  if (!smtp?.host || !smtp?.username || !smtp?.personal_email) {
    return { ok: false as const, error: 'not_configured', message: 'Fill in the SMTP host, username, and your personal email first.' };
  }
  const { error, value: password } = await requireSecret('smtp.password', 'Save your SMTP password first.');
  if (error) return error;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port ?? (smtp.security === 'starttls' ? 587 : 465),
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    auth: { user: smtp.username, pass: password! },
  });
  try {
    await transporter.verify();
    const info = await transporter.sendMail({
      from: smtp.from_address || smtp.username,
      to: smtp.personal_email,
      subject,
      text,
    });
    return { ok: true as const, message_id: info.messageId ?? null, sent_to: smtp.personal_email };
  } catch (err) {
    return { ok: false as const, error: 'send_failed', message: errMsg(err) };
  }
}

async function sendTwilioSms(body: string) {
  const settings = await getSettings();
  const t = settings.twilio;
  if (!t?.account_sid || !t.from_number || !t.to_number) {
    return { ok: false as const, error: 'not_configured', message: 'Fill in the Twilio Account SID and both phone numbers first.' };
  }
  const { error, value: token } = await requireSecret('twilio.auth_token', 'Save your Twilio auth token first.');
  if (error) return error;
  try {
    const client = twilio(t.account_sid, token!);
    await client.api.accounts(t.account_sid).fetch();
    const msg = await client.messages.create({ from: t.from_number, to: t.to_number, body });
    return { ok: true as const, message_sid: msg.sid };
  } catch (err) {
    return { ok: false as const, error: 'twilio_failed', message: errMsg(err) };
  }
}

const testImapConnection = {
  name: 'test_imap_connection',
  description: 'Log in to the college IMAP mailbox (read-only) and select it; returns the mailbox name and unseen message count.',
  sideEffect: 'read' as const,
  paramsSchema: z.object({}).strict(),
  jsonSchema: EMPTY_JSON_SCHEMA,
  async handler() {
    const settings = await getSettings();
    const imap = settings.imap;
    if (!imap?.host || !imap?.username) {
      return { ok: false, error: 'not_configured', message: 'Fill in the IMAP host and username first.' };
    }
    const { error, value: password } = await requireSecret('imap.password', 'Save your IMAP password first.');
    if (error) return error;
    const client = new ImapFlow({
      host: imap.host,
      port: imap.port ?? 993,
      secure: imap.tls !== false,
      auth: { user: imap.username, pass: password! },
      logger: false,
    });
    try {
      await client.connect();
      const mailbox = await client.mailboxOpen(imap.mailbox ?? 'INBOX', { readOnly: true });
      const status = await client.status(mailbox.path, { unseen: true });
      return { ok: true, mailbox: mailbox.path, unseen: status.unseen ?? 0 };
    } catch (err) {
      return { ok: false, error: 'connection_failed', message: errMsg(err) };
    } finally {
      await client.logout().catch(() => {});
    }
  },
};

const HELLO_SUBJECT = '☁️ Redi: hello from Redi';
const HELLO_BODY = "Hi! It's Redi ☁️ — your setup worked. I'll send your college-email summaries and reminders here.";

const testSmtpConnection = {
  name: 'test_smtp_connection',
  description: 'Verify the personal SMTP account and send a real "hello from Redi" test email to the configured personal address.',
  sideEffect: 'write' as const,
  paramsSchema: z.object({}).strict(),
  jsonSchema: EMPTY_JSON_SCHEMA,
  async handler() {
    return sendSmtpMail(HELLO_SUBJECT, HELLO_BODY);
  },
};

const testTwilioConnection = {
  name: 'test_twilio_connection',
  description: 'Validate Twilio credentials and send a test SMS to the student\'s mobile number.',
  sideEffect: 'write' as const,
  paramsSchema: z.object({}).strict(),
  jsonSchema: EMPTY_JSON_SCHEMA,
  async handler() {
    return sendTwilioSms('☁️ Redi: test message — your SMS notifications are working.');
  },
};

const sendTestNotification = {
  name: 'send_test_notification',
  description: 'Send a test message through one notification channel (in_app, email, or sms) so the user can verify delivery end to end.',
  sideEffect: 'write' as const,
  paramsSchema: z.object({ channel: z.enum(['in_app', 'email', 'sms']) }).strict(),
  jsonSchema: {
    type: 'object',
    properties: { channel: { type: 'string', enum: ['in_app', 'email', 'sms'] } },
    required: ['channel'],
    additionalProperties: false,
  },
  async handler(_ctx: Ctx, params: { channel: 'in_app' | 'email' | 'sms' }) {
    void _ctx;
    if (params.channel === 'in_app') {
      const db = await getDb();
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.sql(
        `INSERT INTO notifications (id, type, title, body, importance, channels, scheduled_for, status, related_type, related_id, created_at, sent_at) VALUES ('${id}', 'system', '☁️ Redi test', 'This is how in-app messages from Redi look.', 'normal', '["in_app"]', '${now}', 'sent', NULL, NULL, '${now}', '${now}')`,
      );
      return { ok: true, channel: 'in_app', notification_id: id };
    }
    if (params.channel === 'email') {
      const res = await sendSmtpMail('☁️ Redi: test notification', 'This is a test notification from Redi. Email delivery works.');
      return res.ok ? { ok: true as const, channel: 'email' as const, message_id: res.message_id, sent_to: res.sent_to } : res;
    }
    const res = await sendTwilioSms('☁️ Redi: test notification — SMS delivery works.');
    return res.ok ? { ok: true as const, channel: 'sms' as const, message_sid: res.message_sid } : res;
  },
};

export const connectionTestTools = [
  testAiConnection,
  testImapConnection,
  testSmtpConnection,
  testTwilioConnection,
  sendTestNotification,
];

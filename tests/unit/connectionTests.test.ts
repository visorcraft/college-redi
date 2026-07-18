import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(), getSecret: vi.fn(), sqlExec: vi.fn(),
  getAiClient: vi.fn(), aiCreate: vi.fn(),
  imapConnect: vi.fn(), mailboxOpen: vi.fn(), imapStatus: vi.fn(), imapLogout: vi.fn(),
  smtpVerify: vi.fn(), sendMail: vi.fn(),
  twilioFetch: vi.fn(), messagesCreate: vi.fn(),
}));

vi.mock('@/server/settings', () => ({ getSettings: mocks.getSettings, updateSettings: vi.fn() }));
vi.mock('@/server/secrets', () => ({ getSecret: mocks.getSecret, setSecret: vi.fn() }));
vi.mock('@/server/db/sql', () => ({
  lit: (value: string) => `'${value.replaceAll("'", "''")}'`,
  sqlExec: mocks.sqlExec,
}));
vi.mock('@/server/ai/client', () => {
  class AiNotConfiguredError extends Error {}
  return { getAiClient: mocks.getAiClient, AiNotConfiguredError };
});
vi.mock('imapflow', () => ({
  ImapFlow: vi.fn(function MockImapFlow() {
    return {
      connect: mocks.imapConnect,
      mailboxOpen: mocks.mailboxOpen,
      status: mocks.imapStatus,
      logout: mocks.imapLogout,
    };
  }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ verify: mocks.smtpVerify, sendMail: mocks.sendMail })) },
}));
vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    api: { accounts: () => ({ fetch: mocks.twilioFetch }) },
    messages: { create: mocks.messagesCreate },
  })),
}));

import { connectionTestTools } from '@/server/tools/connectionTests';

const ctx = { actor: 'test' };
const tool = (name: string): {
  paramsSchema: { parse(value: unknown): unknown };
  handler(ctx: { actor: string }, params: any): Promise<any>;
} => {
  const t = connectionTestTools.find((t) => t.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
};

const settingsFixture = {
  imap: { host: 'imap.school.edu', port: 993, tls: true, username: 'stu@school.edu', mailbox: 'INBOX' },
  smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls', username: 'me@gmail.com', from_address: 'Redi <me@gmail.com>', personal_email: 'me@gmail.com' },
  twilio: { account_sid: 'AC123', from_number: '+15550001111', to_number: '+15559998888' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue(settingsFixture);
  mocks.getSecret.mockImplementation(async (name: string) =>
    ({ 'imap.password': 'pw-imap', 'smtp.password': 'pw-smtp', 'twilio.auth_token': 'tok' })[name] ?? null);
  mocks.getAiClient.mockResolvedValue({
    client: { chat: { completions: { create: mocks.aiCreate } } },
    model: 'gpt-5.6-luna', effort: 'medium',
  });
  mocks.imapLogout.mockResolvedValue(undefined);
  mocks.imapStatus.mockResolvedValue({ unseen: 7 });
  mocks.smtpVerify.mockResolvedValue(true);
  mocks.sendMail.mockResolvedValue({ messageId: 'msg-1' });
  mocks.twilioFetch.mockResolvedValue({ sid: 'AC123' });
  mocks.messagesCreate.mockResolvedValue({ sid: 'SM1' });
});

it('marks quota-spending and message-sending tests as writes', () => {
  expect(Object.fromEntries(connectionTestTools.map((item) => [
    item.name,
    item.sideEffect,
  ]))).toMatchObject({
    test_ai_connection: 'write',
    test_imap_connection: 'read',
    test_smtp_connection: 'write',
    test_twilio_connection: 'write',
  });
});

describe('test_ai_connection', () => {
  it('tests candidate settings without requiring them to be saved', async () => {
    mocks.aiCreate.mockResolvedValue({ choices: [{ message: { tool_calls: [{ id: 'c1' }] } }] });
    await tool('test_ai_connection').handler(ctx, {
      base_url: 'http://candidate.test/v1',
      api_key: 'candidate-key',
      model: 'candidate-model',
      effort: 'high',
    });
    expect(mocks.getAiClient).toHaveBeenCalledWith({
      apiKey: 'candidate-key',
      baseURL: 'http://candidate.test/v1',
      model: 'candidate-model',
      effort: 'high',
    });
  });

  it('reports not_configured when the AI client is not set up', async () => {
    const { AiNotConfiguredError } = await import('@/server/ai/client');
    mocks.getAiClient.mockRejectedValue(new AiNotConfiguredError());
    const res: any = await tool('test_ai_connection').handler(ctx, {});
    expect(res).toMatchObject({ ok: false, error: 'not_configured' });
  });

  it('returns model, latency, and tool_calling=true when the model calls the ping tool', async () => {
    mocks.aiCreate.mockResolvedValue({ choices: [{ message: { tool_calls: [{ id: 'c1' }] } }] });
    const res: any = await tool('test_ai_connection').handler(ctx, {});
    expect(res).toMatchObject({ ok: true, model: 'gpt-5.6-luna', tool_calling: true });
    expect(res.latency_ms).toEqual(expect.any(Number));
    expect(mocks.aiCreate).toHaveBeenCalledTimes(1);
    expect(mocks.aiCreate.mock.calls[0][0].tools[0].function.name).toBe('redi_ping');
  });

  it('warns when the model answers without calling tools', async () => {
    mocks.aiCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
    const res: any = await tool('test_ai_connection').handler(ctx, {});
    expect(res.ok).toBe(true);
    expect(res.tool_calling).toBe(false);
    expect(res.warning).toBeTruthy();
  });

  it('falls back to a plain completion when tool calling is rejected', async () => {
    mocks.aiCreate.mockRejectedValueOnce(new Error('400 tools unsupported')).mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });
    const res: any = await tool('test_ai_connection').handler(ctx, {});
    expect(res).toMatchObject({ ok: true, tool_calling: false });
    expect(res.warning).toContain('tool');
  });

  it('fails when both calls fail', async () => {
    mocks.aiCreate.mockRejectedValue(new Error('connection refused'));
    const res: any = await tool('test_ai_connection').handler(ctx, {});
    expect(res).toMatchObject({ ok: false, error: 'request_failed' });
  });
});

describe('test_imap_connection', () => {
  it('uses candidate settings and password without saving them', async () => {
    mocks.mailboxOpen.mockResolvedValue({ path: 'Candidate' });
    await tool('test_imap_connection').handler(ctx, {
      host: 'candidate.imap.test',
      port: 1993,
      tls: false,
      username: 'candidate-user',
      password: 'candidate-password',
      mailbox: 'Candidate',
    });
    expect(vi.mocked(ImapFlow)).toHaveBeenCalledWith(expect.objectContaining({
      host: 'candidate.imap.test',
      port: 1993,
      secure: false,
      auth: { user: 'candidate-user', pass: 'candidate-password' },
    }));
    expect(mocks.mailboxOpen).toHaveBeenCalledWith('Candidate', { readOnly: true });
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });

  it('requires imap settings', async () => {
    mocks.getSettings.mockResolvedValue({ imap: {} });
    const res: any = await tool('test_imap_connection').handler(ctx, {});
    expect(res).toMatchObject({ ok: false, error: 'not_configured' });
  });

  it('requires the stored password', async () => {
    mocks.getSecret.mockResolvedValue(null);
    const res: any = await tool('test_imap_connection').handler(ctx, {});
    expect(res).toMatchObject({ ok: false, error: 'missing_secret' });
  });

  it('logs in, selects the mailbox, returns the unseen count, and logs out', async () => {
    mocks.mailboxOpen.mockResolvedValue({ path: 'INBOX' });
    const res: any = await tool('test_imap_connection').handler(ctx, {});
    expect(res).toEqual({ ok: true, mailbox: 'INBOX', unseen: 7 });
    expect(mocks.imapConnect).toHaveBeenCalledTimes(1);
    expect(mocks.mailboxOpen).toHaveBeenCalledWith('INBOX', { readOnly: true });
    expect(mocks.imapLogout).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ImapFlow)).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    }));
  });

  it('surfaces auth/network failures without throwing', async () => {
    mocks.imapConnect.mockRejectedValue(new Error('Invalid credentials'));
    const res: any = await tool('test_imap_connection').handler(ctx, {});
    expect(res).toMatchObject({ ok: false, error: 'connection_failed', message: 'Invalid credentials' });
  });
});

describe('test_smtp_connection', () => {
  it('uses candidate settings and password without saving them', async () => {
    await tool('test_smtp_connection').handler(ctx, {
      host: 'candidate.smtp.test',
      port: 1587,
      security: 'starttls',
      username: 'candidate-user',
      password: 'candidate-password',
      from_address: 'Candidate <candidate@test>',
      personal_email: 'recipient@test.com',
    });
    expect(vi.mocked(nodemailer.createTransport)).toHaveBeenCalledWith(expect.objectContaining({
      host: 'candidate.smtp.test',
      port: 1587,
      secure: false,
      requireTLS: true,
      auth: { user: 'candidate-user', pass: 'candidate-password' },
    }));
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Candidate <candidate@test>',
      to: 'recipient@test.com',
    }));
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });

  it('verifies and sends a real hello-from-Redi mail to personal_email', async () => {
    const res: any = await tool('test_smtp_connection').handler(ctx, {});
    expect(res).toMatchObject({ ok: true, message_id: 'msg-1', sent_to: 'me@gmail.com' });
    expect(mocks.smtpVerify).toHaveBeenCalledTimes(1);
    const mail = mocks.sendMail.mock.calls[0][0];
    expect(mail.to).toBe('me@gmail.com');
    expect(mail.from).toBe('Redi <me@gmail.com>');
    expect(mail.subject).toContain('Redi');
    expect(vi.mocked(nodemailer.createTransport)).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      }),
    );
  });

  it('reports send failures', async () => {
    mocks.smtpVerify.mockRejectedValue(new Error('ECONNREFUSED'));
    const res: any = await tool('test_smtp_connection').handler(ctx, {});
    expect(res).toMatchObject({ ok: false, error: 'send_failed' });
  });
});

describe('test_twilio_connection', () => {
  it('uses candidate settings and token without saving them', async () => {
    await tool('test_twilio_connection').handler(ctx, {
      account_sid: 'AC-candidate',
      auth_token: 'candidate-token',
      from_number: '+15551110000',
      to_number: '+15552220000',
    });
    expect(mocks.messagesCreate).toHaveBeenCalledWith({
      from: '+15551110000',
      to: '+15552220000',
      body: expect.stringContaining('test message'),
    });
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });

  it('validates credentials and sends a test SMS', async () => {
    const res: any = await tool('test_twilio_connection').handler(ctx, {});
    expect(res).toEqual({ ok: true, message_sid: 'SM1' });
    expect(mocks.twilioFetch).toHaveBeenCalledTimes(1);
    expect(mocks.messagesCreate).toHaveBeenCalledWith(expect.objectContaining({ from: '+15550001111', to: '+15559998888' }));
  });

  it('reports twilio failures', async () => {
    mocks.twilioFetch.mockRejectedValue(new Error('Authenticate'));
    const res: any = await tool('test_twilio_connection').handler(ctx, {});
    expect(res).toMatchObject({ ok: false, error: 'twilio_failed' });
  });
});

describe('send_test_notification', () => {
  it('rejects unknown channels in params', () => {
    expect(() => tool('send_test_notification').paramsSchema.parse({ channel: 'pigeon' })).toThrow();
  });

  it('in_app inserts a sent notifications row via the shared SQL helper', async () => {
    const res: any = await tool('send_test_notification').handler(ctx, { channel: 'in_app' });
    expect(res).toMatchObject({ ok: true, channel: 'in_app' });
    expect(mocks.sqlExec).toHaveBeenCalledTimes(1);
    const sql = mocks.sqlExec.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO notifications');
    expect(sql).toContain('["in_app"]');
    expect(sql).toContain("'sent'");
    expect(sql).toContain(res.notification_id);
  });

  it('email sends via SMTP to personal_email', async () => {
    const res: any = await tool('send_test_notification').handler(ctx, { channel: 'email' });
    expect(res).toMatchObject({ ok: true, channel: 'email' });
    expect(mocks.sendMail.mock.calls[0][0].to).toBe('me@gmail.com');
  });

  it('sms sends via Twilio to to_number', async () => {
    const res: any = await tool('send_test_notification').handler(ctx, { channel: 'sms' });
    expect(res).toMatchObject({ ok: true, channel: 'sms' });
    expect(mocks.messagesCreate.mock.calls[0][0].to).toBe('+15559998888');
  });

  it('email channel reports not_configured without smtp settings', async () => {
    mocks.getSettings.mockResolvedValue({ smtp: {} });
    const res: any = await tool('send_test_notification').handler(ctx, { channel: 'email' });
    expect(res).toMatchObject({ ok: false, error: 'not_configured' });
  });
});

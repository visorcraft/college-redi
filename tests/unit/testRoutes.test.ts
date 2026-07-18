import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ callTool: vi.fn() }));
vi.mock('@/server/tools/call', () => ({ callTool: mocks.callTool }));

import { POST as postTestAi } from '@/app/api/settings/test/ai/route';
import { POST as postTestImap } from '@/app/api/settings/test/imap/route';
import { POST as postTestSmtp } from '@/app/api/settings/test/smtp/route';
import { POST as postTestTwilio } from '@/app/api/settings/test/twilio/route';
import { POST as postTestChannel } from '@/app/api/notifications/test/[channel]/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callTool.mockResolvedValue({ ok: true });
});

describe('POST /api/settings/test/*', () => {
  it('ai route calls test_ai_connection as user', async () => {
    const params = { base_url: 'http://ai.test/v1', api_key: 'candidate-key', model: 'test-model' };
    const res = await postTestAi(request(params));
    expect(mocks.callTool).toHaveBeenCalledWith('test_ai_connection', params, { actor: 'user' });
    expect(await res.json()).toEqual({ ok: true });
  });

  it('imap route calls test_imap_connection', async () => {
    const params = { host: 'imap.test', username: 'student', password: 'candidate-password' };
    await postTestImap(request(params));
    expect(mocks.callTool).toHaveBeenCalledWith('test_imap_connection', params, { actor: 'user' });
  });

  it('smtp route calls test_smtp_connection', async () => {
    const params = { host: 'smtp.test', username: 'student', password: 'candidate-password' };
    await postTestSmtp(request(params));
    expect(mocks.callTool).toHaveBeenCalledWith('test_smtp_connection', params, { actor: 'user' });
  });

  it('twilio route calls test_twilio_connection', async () => {
    const params = { account_sid: 'AC456', auth_token: 'candidate-token' };
    await postTestTwilio(request(params));
    expect(mocks.callTool).toHaveBeenCalledWith('test_twilio_connection', params, { actor: 'user' });
  });
});

function request(body: unknown) {
  return new Request('http://localhost/api/settings/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/notifications/test/:channel', () => {
  const req = new Request('http://localhost/api/notifications/test/email', { method: 'POST' });

  it('calls send_test_notification for a valid channel', async () => {
    const res = await postTestChannel(req, { params: Promise.resolve({ channel: 'sms' }) });
    expect(mocks.callTool).toHaveBeenCalledWith('send_test_notification', { channel: 'sms' }, { actor: 'user' });
    expect(res.status).toBe(200);
  });

  it('rejects an invalid channel with 400 and never calls the tool', async () => {
    const res = await postTestChannel(req, { params: Promise.resolve({ channel: 'pigeon' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('bad_channel');
    expect(mocks.callTool).not.toHaveBeenCalled();
  });
});

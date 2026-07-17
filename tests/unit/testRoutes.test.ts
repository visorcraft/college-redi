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
    const res = await postTestAi();
    expect(mocks.callTool).toHaveBeenCalledWith('test_ai_connection', {}, { actor: 'user' });
    expect(await res.json()).toEqual({ ok: true });
  });

  it('imap route calls test_imap_connection', async () => {
    await postTestImap();
    expect(mocks.callTool).toHaveBeenCalledWith('test_imap_connection', {}, { actor: 'user' });
  });

  it('smtp route calls test_smtp_connection', async () => {
    await postTestSmtp();
    expect(mocks.callTool).toHaveBeenCalledWith('test_smtp_connection', {}, { actor: 'user' });
  });

  it('twilio route calls test_twilio_connection', async () => {
    await postTestTwilio();
    expect(mocks.callTool).toHaveBeenCalledWith('test_twilio_connection', {}, { actor: 'user' });
  });
});

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

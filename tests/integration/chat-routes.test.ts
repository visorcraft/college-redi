import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startStubAiServer,
  type StubServer,
} from '../fixtures/ai/stub-server';

let stub: StubServer | null = null;
let dataDir: string | null = null;

afterEach(async () => {
  await stub?.close();
  stub = null;
  const { _resetDbForTests } = await import('../../src/server/db/client');
  _resetDbForTests();
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
  dataDir = null;
});

async function boot(
  configureAi: boolean,
  replies: Parameters<typeof startStubAiServer>[0] = [],
) {
  try {
    const { _resetDbForTests } = await import('../../src/server/db/client');
    const { _resetRegistryForTests } = await import('../../src/server/tools/registry');
    const { _resetToolsForTests } = await import('../../src/server/tools');
    _resetDbForTests();
    _resetRegistryForTests();
    _resetToolsForTests();
  } catch {
    // No shared modules are active on first boot.
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redi-chat-routes-'));
  dataDir = dir;
  Object.assign(process.env, {
    DATA_DIR: dir,
    DATABASE_MODE: 'embedded',
    MONGRELDB_PATH: path.join(dir, 'db'),
    MONGRELDB_PASSPHRASE: 'test-passphrase',
    MONGRELDB_DB_USERNAME: 'redi',
    MONGRELDB_DB_PASSWORD: 'test-password',
    REDI_MASTER_KEY: 'a'.repeat(64),
  });
  vi.resetModules();

  const { runMigrations } = await import('../../src/server/db/migrate');
  await runMigrations();
  const {
    _resetToolsForTests,
    registerAllTools,
  } = await import('../../src/server/tools');
  const { _resetRegistryForTests } = await import('../../src/server/tools/registry');
  _resetRegistryForTests();
  _resetToolsForTests();
  registerAllTools();

  if (configureAi) {
    stub = await startStubAiServer(replies);
    const { updateSettings } = await import('../../src/server/settings');
    await updateSettings({
      ai: { base_url: stub.url, model: 'stub-model', effort: 'low' },
    });
    const { setSecret } = await import('../../src/server/secrets');
    await setSecret('ai.api_key', 'sk-test');
  }

  const conversations = await import(
    '../../src/app/api/chat/conversations/route'
  );
  const conversation = await import(
    '../../src/app/api/chat/conversations/[id]/route'
  );
  const messages = await import(
    '../../src/app/api/chat/conversations/[id]/messages/route'
  );
  const status = await import('../../src/app/api/redi/status/route');
  return {
    conversations,
    conversation,
    messages,
    status,
    stub: stub!,
  };
}

async function readSse(response: Response) {
  return (await response.text())
    .split('\n\n')
    .filter(Boolean)
    .map((block) => ({
      event: /^event: (.*)$/m.exec(block)?.[1],
      data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}'),
    }));
}

const post = (url: string, body: unknown) => new Request(`http://x${url}`, {
  method: 'POST',
  body: JSON.stringify(body),
});

describe('chat and Redi status routes', () => {
  it('creates and lists conversations, then 404s unknown IDs', async () => {
    const { conversations, conversation } = await boot(false);
    const created = await (await conversations.POST(
      post('/api/chat/conversations', {}),
    )).json();
    expect(created.title).toBe('New chat');
    expect((await (await conversations.GET()).json()).conversations)
      .toHaveLength(1);

    const missing = await conversation.GET(new Request('http://x'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(missing.status).toBe(404);
    const found = await conversation.GET(new Request('http://x'), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(found.status).toBe(200);
    expect((await found.json()).messages).toEqual([]);
  });

  it('reports whether AI is configured', async () => {
    const { status } = await boot(false);
    expect(await (await status.GET()).json()).toEqual({
      aiConfigured: false,
      unreadCount: 0,
      jobRunning: false,
    });
    const { updateSettings } = await import('../../src/server/settings');
    await updateSettings({
      ai: {
        base_url: 'http://127.0.0.1:9/v1',
        model: 'gpt-5.6-luna',
        effort: 'medium',
      },
    });
    const { setSecret } = await import('../../src/server/secrets');
    await setSecret('ai.api_key', 'sk-test');
    expect((await (await status.GET()).json()).aiConfigured).toBe(true);
  });

  it('returns 503 when AI is not configured', async () => {
    const { conversations, messages } = await boot(false);
    const created = await (await conversations.POST(
      post('/api/chat/conversations', {}),
    )).json();
    const response = await messages.POST(
      post('/messages', { message: 'hi' }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('ai_not_configured');
  });

  it('rejects a blank message', async () => {
    const { conversations, messages } = await boot(true);
    const created = await (await conversations.POST(
      post('/api/chat/conversations', {}),
    )).json();
    const response = await messages.POST(
      post('/messages', { message: '  ' }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(response.status).toBe(400);
  });

  it('streams deltas and tool activity, then persists the turn', async () => {
    const {
      conversations,
      conversation,
      messages,
      stub: ai,
    } = await boot(true, [
      {
        toolCalls: [{
          name: 'get_system_status',
          arguments: '{}',
        }],
      },
      { content: 'Everything is sunny ☀️' },
    ]);
    const created = await (await conversations.POST(
      post('/api/chat/conversations', {}),
    )).json();
    const response = await messages.POST(
      post('/messages', { message: 'status check' }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = await readSse(response);
    expect(events.some((event) => event.event === 'delta')).toBe(true);
    expect(events.find((event) => event.event === 'tool')?.data)
      .toMatchObject({ phase: 'start', name: 'get_system_status' });
    expect(events.find((event) => event.event === 'done')?.data.text)
      .toBe('Everything is sunny ☀️');
    expect((ai.requests[0].tools as unknown[]).length).toBeGreaterThan(0);

    const detail = await (await conversation.GET(new Request('http://x'), {
      params: Promise.resolve({ id: created.id }),
    })).json();
    expect(detail.messages.map((message: { role: string }) => message.role))
      .toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(detail.conversation.title).toBe('status check');
  });
});

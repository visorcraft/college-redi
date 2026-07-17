import { rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let dataDir = '';
const ENV_KEYS = [
  'DATA_DIR',
  'DATABASE_MODE',
  'MONGRELDB_PATH',
  'MONGRELDB_PASSPHRASE',
  'MONGRELDB_DB_USERNAME',
  'MONGRELDB_DB_PASSWORD',
  'REDI_MASTER_KEY',
] as const;
let previousEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeAll(async () => {
  previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redi-chat-test-'));
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    DATABASE_MODE: 'embedded',
    MONGRELDB_PATH: path.join(dataDir, 'db'),
    MONGRELDB_PASSPHRASE: 'test-passphrase',
    MONGRELDB_DB_USERNAME: 'redi',
    MONGRELDB_DB_PASSWORD: 'test-password',
    REDI_MASTER_KEY: 'a'.repeat(64),
  });
  const { _resetDbForTests } = await import('../../src/server/db/client');
  const { _resetConfigForTests } = await import('../../src/server/config');
  _resetDbForTests();
  _resetConfigForTests();
  const { runMigrations } = await import('../../src/server/db/migrate');
  await runMigrations();
});

beforeEach(async () => {
  const { sqlExec } = await import('../../src/server/db/sql');
  await sqlExec('DELETE FROM chat_messages');
  await sqlExec('DELETE FROM chat_conversations');
});

afterAll(async () => {
  const { _resetDbForTests } = await import('../../src/server/db/client');
  const { _resetConfigForTests } = await import('../../src/server/config');
  _resetDbForTests();
  _resetConfigForTests();
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe('chat store', () => {
  it('creates, lists, and touches conversations', async () => {
    const store = await import('../../src/server/chat/store');
    const first = await store.createConversation();
    expect(first.title).toBe('New chat');
    await store.touchConversation(first.id, 'First chat');
    const second = await store.createConversation('Second');
    expect((await store.listConversations()).map((conversation) => conversation.id))
      .toEqual([second.id, first.id]);
    expect((await store.getConversation(first.id))?.title).toBe('First chat');
    expect(await store.getConversation('missing')).toBeNull();
  });

  it('returns all messages ascending and limits to the last N', async () => {
    const store = await import('../../src/server/chat/store');
    const conversation = await store.createConversation();
    for (let index = 1; index <= 25; index += 1) {
      await store.appendMessage({
        conversation_id: conversation.id,
        role: 'user',
        content: `m${index}`,
        tool_calls: null,
        created_at: `2026-07-17T00:00:${String(index).padStart(2, '0')}.000Z`,
      });
    }
    expect(await store.listMessages(conversation.id)).toHaveLength(25);
    const window = await store.listMessages(conversation.id, 20);
    expect([window[0].content, window[19].content]).toEqual(['m6', 'm25']);
  });

  it('round-trips tool_calls JSON', async () => {
    const store = await import('../../src/server/chat/store');
    const conversation = await store.createConversation();
    const calls = JSON.stringify([{
      id: 'call_1',
      name: 'list_tasks',
      arguments: '{}',
    }]);
    await store.appendMessage({
      conversation_id: conversation.id,
      role: 'assistant',
      content: '',
      tool_calls: calls,
    });
    await store.appendMessage({
      conversation_id: conversation.id,
      role: 'tool',
      content: '{"tasks":[]}',
      tool_calls: JSON.stringify([{ id: 'call_1', name: 'list_tasks' }]),
    });
    const messages = await store.listMessages(conversation.id);
    expect(messages.map((message) => message.role)).toEqual(['assistant', 'tool']);
    expect(JSON.parse(messages[0].tool_calls ?? 'null')).toEqual([{
      id: 'call_1',
      name: 'list_tasks',
      arguments: '{}',
    }]);
  });
});

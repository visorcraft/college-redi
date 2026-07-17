import { rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startStubAiServer,
  type StubReply,
  type StubServer,
} from '../fixtures/ai/stub-server';

const mocks = vi.hoisted(() => ({
  tools: [
    {
      name: 'get_system_status',
      description: 'System health',
      sideEffect: 'read',
      jsonSchema: { type: 'object', properties: {} },
    },
    {
      name: 'create_task',
      description: 'Create a task',
      sideEffect: 'write',
      jsonSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
      },
    },
    {
      name: 'delete_task',
      description: 'Delete a task forever',
      sideEffect: 'destructive',
      jsonSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  ],
  callTool: vi.fn(),
}));

vi.mock('../../src/server/tools/registry', () => ({
  listTools: () => mocks.tools,
}));
vi.mock('../../src/server/tools/call', () => ({
  callTool: mocks.callTool,
}));

interface StubRequest {
  model: string;
  reasoning_effort?: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<{ function: { name: string } }>;
}

let dataDir = '';
let stub: StubServer | null = null;
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
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redi-agent-test-'));
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
  for (const table of [
    'chat_messages',
    'chat_conversations',
    'secrets',
    'app_settings',
  ]) {
    await sqlExec(`DELETE FROM ${table}`);
  }
  mocks.callTool.mockReset();
  mocks.callTool.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  await stub?.close();
  stub = null;
});

afterAll(async () => {
  const { _resetDbForTests } = await import('../../src/server/db/client');
  const { _resetConfigForTests } = await import('../../src/server/config');
  const { _resetKeysForTests } = await import('../../src/server/keys');
  _resetDbForTests();
  _resetConfigForTests();
  _resetKeysForTests();
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

async function boot(replies: StubReply[]) {
  stub = await startStubAiServer(replies);
  const { updateSettings } = await import('../../src/server/settings');
  await updateSettings({
    ai: { base_url: stub.url, model: 'stub-model', effort: 'low' },
  });
  const { setSecret } = await import('../../src/server/secrets');
  await setSecret('ai.api_key', 'sk-test');
  return {
    store: await import('../../src/server/chat/store'),
    agent: await import('../../src/server/ai/agent'),
    callTool: mocks.callTool,
    stub,
  };
}

function collect() {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    onEvent: (event: Record<string, unknown>) => events.push(event),
  };
}

describe('Redi agent loop', () => {
  it('streams a plain answer and persists user and assistant messages', async () => {
    const context = await boot([{ content: 'Sunny skies ahead ☀️' }]);
    const conversation = await context.store.createConversation();
    const { events, onEvent } = collect();
    const result = await context.agent.runAgentTurn(conversation.id, 'hello', onEvent);
    expect(result.text).toBe('Sunny skies ahead ☀️');
    expect(events.filter((event) => event.type === 'delta')
      .map((event) => event.text).join('')).toBe('Sunny skies ahead ☀️');
    expect(events.at(-1)).toEqual({ type: 'done', text: 'Sunny skies ahead ☀️' });
    expect((await context.store.listMessages(conversation.id))
      .map((message) => message.role)).toEqual(['user', 'assistant']);
    const request = context.stub.requests[0] as unknown as StubRequest;
    expect(request.model).toBe('stub-model');
    expect(request.reasoning_effort).toBe('low');
    expect(request.messages[0].role).toBe('system');
  });

  it('runs a tool round and feeds the result back', async () => {
    const context = await boot([
      { toolCalls: [{ name: 'get_system_status', arguments: '{}' }] },
      { content: 'All systems sunny ☀️' },
    ]);
    const conversation = await context.store.createConversation();
    const { events, onEvent } = collect();
    const result = await context.agent.runAgentTurn(
      conversation.id,
      'is everything ok?',
      onEvent,
    );
    expect(result.text).toBe('All systems sunny ☀️');
    expect(context.callTool).toHaveBeenCalledWith(
      'get_system_status',
      {},
      { actor: 'redi' },
    );
    expect(events.filter((event) => event.type === 'tool_start')
      .map((event) => event.name)).toEqual(['get_system_status']);
    const messages = await context.store.listMessages(conversation.id);
    expect(messages.map((message) => message.role))
      .toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(JSON.parse(messages[1].tool_calls ?? '[]')[0].name).toBe('get_system_status');
    expect(messages[2].content).toBe('{"ok":true}');
    const second = context.stub.requests[1] as unknown as StubRequest;
    expect(second.messages.at(-1)?.role).toBe('tool');
    expect(second.messages.at(-1)?.tool_call_id).toBeTruthy();
  });

  it('arms destructive tools only after an affirmative confirmation', async () => {
    const context = await boot([
      { content: 'This deletes the task forever. Reply yes to confirm.' },
      { toolCalls: [{ name: 'delete_task', arguments: '{"id":"t1"}' }] },
      { content: 'Done, task deleted.' },
    ]);
    const conversation = await context.store.createConversation();
    await context.agent.runAgentTurn(
      conversation.id,
      'delete the transcript task',
      () => undefined,
    );
    const first = context.stub.requests[0] as unknown as StubRequest;
    expect(first.tools?.map((tool) => tool.function.name))
      .toEqual(['get_system_status', 'create_task']);
    await context.agent.runAgentTurn(conversation.id, 'yes', () => undefined);
    const second = context.stub.requests[1] as unknown as StubRequest;
    expect(second.tools?.map((tool) => tool.function.name)).toContain('delete_task');
    expect(context.callTool).toHaveBeenCalledWith(
      'delete_task',
      { id: 't1', confirm: true },
      { actor: 'redi' },
    );
  });

  it('refuses an unarmed destructive call', async () => {
    const context = await boot([
      { toolCalls: [{ name: 'delete_task', arguments: '{"id":"t1"}' }] },
      { content: 'I need your confirmation first.' },
    ]);
    const conversation = await context.store.createConversation();
    const result = await context.agent.runAgentTurn(
      conversation.id,
      'delete everything',
      () => undefined,
    );
    expect(result.text).toBe('I need your confirmation first.');
    expect(context.callTool).not.toHaveBeenCalledWith(
      'delete_task',
      expect.anything(),
      expect.anything(),
    );
    const second = context.stub.requests[1] as unknown as StubRequest;
    expect(second.messages.at(-1)?.content).toMatch(/confirm/i);
  });

  it('forces a final answer without tools after eight tool rounds', async () => {
    const replies: StubReply[] = Array.from(
      { length: 8 },
      () => ({ toolCalls: [{ name: 'get_system_status', arguments: '{}' }] }),
    );
    replies.push({ content: 'Final answer after many checks.' });
    const context = await boot(replies);
    const conversation = await context.store.createConversation();
    const result = await context.agent.runAgentTurn(
      conversation.id,
      'keep checking',
      () => undefined,
    );
    expect(result.text).toBe('Final answer after many checks.');
    expect(context.stub.requests).toHaveLength(9);
    const forced = context.stub.requests[8] as unknown as StubRequest;
    expect(forced.tools).toBeUndefined();
  });

  it('recognizes an explicit confirmation exchange', async () => {
    const { shouldArmDestructive } = await import('../../src/server/ai/agent');
    expect(shouldArmDestructive('Shall I delete it? Reply yes to confirm.', 'yes'))
      .toBe(true);
    expect(shouldArmDestructive('Shall I delete it? Reply yes to confirm.', 'no way'))
      .toBe(false);
    expect(shouldArmDestructive('Here is your task list.', 'yes')).toBe(false);
    expect(shouldArmDestructive(null, 'yes')).toBe(false);
  });

  it('builds fresh snapshot and persona guardrails', async () => {
    const context = await boot([{ content: 'x' }]);
    context.callTool.mockImplementation(async (name: string) => {
      if (name === 'list_programs') {
        return {
          programs: [{
            name: 'BS Computer Science',
            institution: 'State U',
            status: 'active',
          }],
        };
      }
      if (name === 'get_degree_progress') return { overall: { percent: 42.4 } };
      if (name === 'list_tasks') {
        return {
          tasks: [{
            title: 'FAFSA renewal',
            due_at: '2026-08-01T00:00:00.000Z',
          }],
        };
      }
      if (name === 'list_notifications') return { notifications: [{}, {}] };
      throw new Error('boom');
    });
    const snapshot = await context.agent.buildStudentSnapshot();
    expect(snapshot).toContain('BS Computer Science');
    expect(snapshot).toContain('42%');
    expect(snapshot).toContain('FAFSA renewal');
    expect(snapshot).toContain('Unread notifications: 2');
    const prompt = context.agent.buildSystemPrompt(
      new Date('2026-07-17T15:00:00Z'),
      'America/Chicago',
      snapshot,
      null,
    );
    expect(prompt).toContain('America/Chicago');
    expect(prompt).toContain('BS Computer Science');
    expect(prompt).toContain('120 words');
    expect(prompt).toContain('Never invent dates');
    expect(prompt).toContain('navy-blue cloud');
  });
});

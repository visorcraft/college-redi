import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';
import { defineTool, listTools, registerTool } from '@/server/tools/registry';
import { callTool, ToolConfirmationRequiredError, ToolNotFoundError, ToolValidationError } from '@/server/tools/call';
import { registerAllTools } from '@/server/tools';
import { getKitDb } from '@/server/db/client';
import { auditLog } from '../../db/schema';

let env: TestEnv;
beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
});
afterEach(() => env.cleanup());

const ctx = { actor: 'user' };

describe('tool registry', () => {
  it('registers, lists sorted, projects JSON schema, and rejects duplicates', () => {
    const b = defineTool({ name: 'b_tool', description: 'b', sideEffect: 'read', paramsSchema: z.object({}), handler: async () => 1 });
    const a = defineTool({ name: 'a_tool', description: 'a', sideEffect: 'read', paramsSchema: z.object({}), handler: async () => 2 });
    registerTool(b);
    registerTool(a);
    expect(listTools().map((t) => t.name)).toEqual(['a_tool', 'b_tool']);
    expect(a.jsonSchema).toMatchObject({ type: 'object' });
    expect(() => registerTool(a)).toThrow(/duplicate/);
  });
});

describe('callTool', () => {
  it('rejects unknown tools, invalid params, and unconfirmed destructive calls', async () => {
    registerAllTools();
    await expect(callTool('nope', {}, ctx)).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(callTool('update_settings', { imap: { port: 'not-a-number' } }, ctx)).rejects.toBeInstanceOf(ToolValidationError);
    registerTool(defineTool({
      name: 'danger_tool',
      description: 'test destructive tool',
      sideEffect: 'destructive',
      paramsSchema: z.object({ confirm: z.boolean().optional() }),
      handler: async () => 'done',
    }));
    await expect(callTool('danger_tool', {}, ctx)).rejects.toBeInstanceOf(ToolConfirmationRequiredError);
    await expect(callTool('danger_tool', { confirm: true }, ctx)).resolves.toBe('done');
  });

  it('writes audit_log rows for success and failure, never including params', async () => {
    registerAllTools();
    await callTool('set_secret', { name: 'ai.api_key', value: 'sk-should-not-appear' }, ctx);
    await expect(callTool('update_settings', { ai: { effort: 'extreme' } }, ctx)).rejects.toThrow();
    const db = await getKitDb();
    const rows = db.selectFrom(auditLog).executeSync();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((r) => r.tool_name)).toEqual(expect.arrayContaining(['set_secret', 'update_settings']));
    expect(rows.every((r) => r.actor === 'user')).toBe(true);
    for (const r of rows) expect(String(r.detail)).not.toContain('sk-should-not-appear');
  });
});

describe('settings & system tools', () => {
  it('get_settings returns defaults with secrets as set flags', async () => {
    registerAllTools();
    const result = (await callTool('get_settings', {}, ctx)) as Record<string, any>;
    expect(result.ai.model).toBe('gpt-5.6-luna');
    expect(result.ai.effort).toBe('medium');
    expect(result.quiet_hours).toEqual({ start: '22:00', end: '08:00' });
    expect(result.secrets['ai.api_key']).toEqual({ set: false });
  });

  it('update_settings deep-merges and set_secret flips the set flag without leaking values', async () => {
    registerAllTools();
    const updated = (await callTool('update_settings', { ai: { model: 'gpt-x' }, timezone: 'America/Chicago' }, ctx)) as Record<string, any>;
    expect(updated.ai.model).toBe('gpt-x');
    expect(updated.ai.base_url).toBe('https://api.openai.com/v1');
    expect(updated.timezone).toBe('America/Chicago');
    await callTool('set_secret', { name: 'imap.password', value: 'hunter2' }, ctx);
    const after = (await callTool('get_settings', {}, ctx)) as Record<string, any>;
    expect(after.secrets['imap.password']).toEqual({ set: true });
    expect(JSON.stringify(after)).not.toContain('hunter2');
  });

  it('get_system_status reports db/ai/imap/smtp/twilio/scheduler shape', async () => {
    registerAllTools();
    const status = (await callTool('get_system_status', {}, ctx)) as Record<string, any>;
    expect(status.db).toMatchObject({ mode: 'embedded', ok: true });
    expect(status.db.tables).toBeGreaterThanOrEqual(19);
    expect(status.ai).toMatchObject({ configured: false, model: 'gpt-5.6-luna', effort: 'medium' });
    expect(status.imap).toMatchObject({ configured: false, enabled: false, last_poll_at: null });
    expect(status.scheduler).toMatchObject({ enabled: false, alive: false });
    expect(status.notifications).toMatchObject({ pending: 0 });
  });
});

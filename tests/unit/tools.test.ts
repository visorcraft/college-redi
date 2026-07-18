import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';
import { defineTool, listTools, registerTool } from '@/server/tools/registry';
import { callTool, ToolConfirmationRequiredError, ToolNotFoundError, ToolValidationError } from '@/server/tools/call';
import { registerAllTools } from '@/server/tools';
import { getKitDb } from '@/server/db/client';
import { sqlExec } from '@/server/db/sql';
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
    expect(status.db).toMatchObject({
      mode: 'embedded',
      lock: 'held by this Redi process',
      ok: true,
    });
    expect(status.db.tables).toBeGreaterThanOrEqual(19);
    expect(status.ai).toMatchObject({ configured: false, model: 'gpt-5.6-luna', effort: 'medium' });
    expect(status.imap).toMatchObject({ configured: false, enabled: false, last_poll_at: null });
    expect(status.smtp).toMatchObject({ configured: false });
    expect(status.twilio).toMatchObject({ configured: false });
    expect(status.scheduler).toMatchObject({ enabled: false, alive: false });
    expect(status.notifications).toMatchObject({ pending: 0 });
  });

  it('get_system_status reports an exhausted delivery without leaking its destination', async () => {
    registerAllTools();
    const notification = await callTool('schedule_notification', {
      title: 'Deadline',
      body: 'Submit the form.',
      scheduled_for: '2026-07-17T12:00:00.000Z',
      channels: ['email'],
    }, ctx) as { id: string };
    await sqlExec(
      `UPDATE notifications SET status = 'failed' WHERE id = '${notification.id}'`,
    );
    await sqlExec(
      `INSERT INTO notification_history (` +
      `id, notification_id, channel, destination, status, provider_response, attempt, sent_at` +
      `) VALUES (` +
      `'history-failed', '${notification.id}', 'email', 'student@example.com', ` +
      `'failed', '{"error":"auth failed"}', 4, '2026-07-17T12:05:00.000Z')`,
    );
    const status = await callTool('get_system_status', {}, ctx) as Record<string, any>;
    expect(status.smtp.last_delivery_error)
      .toBe('A scheduled email failed after all retries.');
    expect(JSON.stringify(status)).not.toContain('student@example.com');
  });

  it('search_all finds tasks, courses, emails, and notifications without case sensitivity', async () => {
    registerAllTools();
    const program = await callTool('create_program', {
      name: 'Biology',
      institution: 'State University',
      total_credits_required: 120,
    }, ctx) as { id: string };
    await callTool('add_course', {
      program_id: program.id,
      code: 'BIO 101',
      title: 'Biology Foundations',
      credits: 4,
    }, ctx);
    const task = await callTool('create_task', {
      title: 'Biology advising form',
      category: 'payment',
    }, ctx) as { id: string };
    const { insertProcessedEmail } = await import('@/server/email/store');
    const emailId = await insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 1,
      uidvalidity: 1,
      message_id: '<biology@example.edu>',
      from_addr: 'advisor@example.edu',
      subject: 'Biology department update',
      received_at: new Date().toISOString(),
      classification: 'informational',
      summary: 'Biology office hours changed.',
      extracted_count: 0,
      notified: false,
      processed_at: new Date().toISOString(),
    });
    const notification = await callTool('schedule_notification', {
      title: 'Biology reminder',
      body: 'Review biology plan.',
      scheduled_for: new Date().toISOString(),
    }, ctx) as { id: string };

    const found = await callTool('search_all', {
      query: 'BIOLOGY',
    }, ctx) as { results: Array<{ kind: string }>; total: number };
    expect(new Set(found.results.map((row) => row.kind)))
      .toEqual(new Set(['task', 'course', 'email', 'notification']));
    expect(found.total).toBe(4);

    const selectedFields = [
      ['payment', 'task', task.id],
      ['informational', 'email', emailId],
    ] as const;
    for (const [query, kind, id] of selectedFields) {
      const result = await callTool('search_all', { query }, ctx) as {
        results: Array<{ kind: string; id: string }>;
      };
      expect(result.results).toContainEqual(expect.objectContaining({ kind, id }));
    }

    const { sqlExec } = await import('@/server/db/sql');
    await sqlExec(
      `UPDATE notifications SET type = 'deadline_marker', status = 'failed' ` +
      `WHERE id = '${notification.id}'`,
    );
    for (const query of ['deadline_marker', 'failed']) {
      const result = await callTool('search_all', { query }, ctx) as {
        results: Array<{ kind: string; id: string }>;
      };
      expect(result.results).toContainEqual(expect.objectContaining({
        kind: 'notification',
        id: notification.id,
      }));
    }
  });
});

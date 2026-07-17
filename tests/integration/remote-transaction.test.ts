import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const remoteUrl = process.env.MONGRELDB_LIVE_URL;

describe.runIf(remoteUrl)('remote SQL transactions', () => {
  beforeAll(async () => {
    process.env.DATABASE_MODE = 'remote';
    process.env.MONGRELDB_URL = remoteUrl;
    process.env.MONGRELDB_DB_USERNAME = process.env.MONGRELDB_LIVE_USERNAME ?? 'redi';
    process.env.MONGRELDB_DB_PASSWORD = process.env.MONGRELDB_LIVE_PASSWORD;
    process.env.MONGRELDB_PASSPHRASE = process.env.MONGRELDB_LIVE_PASSPHRASE;
    const { resetServerState } = await import('../helpers/env');
    await resetServerState();
    const { getDb } = await import('../../src/server/db/client');
    const { runMigrations } = await import('../../src/server/db/migrate');
    await runMigrations(await getDb());
  });

  afterAll(async () => {
    const { resetServerState } = await import('../helpers/env');
    await resetServerState();
  });

  it('commits and rolls back cross-table writes through one daemon session', async () => {
    const { sqlRows } = await import('../../src/server/db/sql');
    const { withTransaction, insertProcessedEmail, insertExtractedEvent } = await import(
      '../../src/server/email/store'
    );
    const add = async (uid: number) => {
      const emailId = await insertProcessedEmail({
        mailbox: 'INBOX',
        uid,
        uidvalidity: 1,
        message_id: `<remote-${uid}@x>`,
        from_addr: 'a@x',
        subject: 's',
        received_at: new Date().toISOString(),
        classification: 'unprocessed',
        summary: null,
        extracted_count: 0,
        notified: false,
        processed_at: null,
      });
      await insertExtractedEvent({
        email_id: emailId,
        title: 't',
        event_type: 'general',
        due_at: null,
        confidence: 0.5,
        status: 'pending_review',
        task_id: null,
      });
    };

    const requests: Array<{ sql: string; session: string | null }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/sql') && typeof init?.body === 'string') {
        requests.push({
          sql: (JSON.parse(init.body) as { sql: string }).sql,
          session: new Headers(init.headers).get('x-session-id'),
        });
      }
      return originalFetch(input, init);
    };
    try {
      await expect(withTransaction(async () => {
        await add(901);
        throw new Error('rollback');
      })).rejects.toThrow('rollback');
      await withTransaction(() => add(902));
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(requests.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      'BEGIN',
      expect.stringContaining('INSERT INTO emails_processed'),
      expect.stringContaining('INSERT INTO extracted_events'),
      'ROLLBACK',
      'COMMIT',
    ]));
    expect(new Set(requests.slice(0, 4).map(({ session }) => session)).size).toBe(1);

    expect(await sqlRows<{ uid: number }>(
      'SELECT uid FROM emails_processed WHERE uid >= 901 ORDER BY uid',
    )).toEqual([{ uid: 902 }]);
    expect(await sqlRows<{ uid: number }>(
      `SELECT p.uid FROM extracted_events e
       JOIN emails_processed p ON p.id = e.email_id
       WHERE p.uid >= 901`,
    )).toEqual([{ uid: 902 }]);
  });

  it('returns a newly created task from inside a remote transaction', async () => {
    const { registerAllTools } = await import('../../src/server/tools');
    const { callTool } = await import('../../src/server/tools/call');
    const { withTransaction } = await import('../../src/server/email/store');
    registerAllTools();
    const task = await withTransaction(() => callTool(
      'create_task',
      { title: `remote task ${randomUUID()}` },
      { actor: 'test' },
    )) as { id: string; status: string };
    expect(task.status).toBe('pending');
  });

  it('recovers success when the COMMIT response is lost', async () => {
    const { sqlRows } = await import('../../src/server/db/sql');
    const { insertSenderRule, withTransaction } = await import('../../src/server/email/store');
    const pattern = `loss-${randomUUID()}.example`;
    const originalFetch = globalThis.fetch;
    let dropped = false;
    globalThis.fetch = async (input, init) => {
      if (!dropped && String(input).endsWith('/sql') && typeof init?.body === 'string') {
        const { sql } = JSON.parse(init.body) as { sql: string };
        if (sql === 'COMMIT') {
          dropped = true;
          const response = await originalFetch(input, init);
          await response.arrayBuffer();
          throw new Error('simulated lost COMMIT response');
        }
      }
      return originalFetch(input, init);
    };
    try {
      await withTransaction(() => insertSenderRule({ pattern, action: 'junk' }));
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(dropped).toBe(true);
    expect(await sqlRows<{ pattern: string }>(
      `SELECT pattern FROM sender_rules WHERE pattern = '${pattern}'`,
    )).toEqual([{ pattern }]);
  });
});

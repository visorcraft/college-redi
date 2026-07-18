import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';
import { _resetDbForTests, getDb } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';

const EXPECTED_TABLES = [
  'app_settings', 'secrets', 'mcp_tokens',
  'degree_programs', 'courses', 'requirements', 'completed_courses', 'terms', 'planned_courses',
  'tasks', 'extracted_events',
  'emails_processed', 'sender_rules',
  'notifications', 'notification_history',
  'chat_conversations', 'chat_messages', 'audit_log', 'job_leases',
];

let env: TestEnv;
beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
});
afterEach(async () => {
  await resetServerState();
  env.cleanup();
});

describe('runMigrations', () => {
  it('creates every spec §7 table and is idempotent', async () => {
    const db = await getDb();
    await runMigrations(db);
    const names = db.tableNames();
    for (const t of EXPECTED_TABLES) expect(names).toContain(t);
    await expect(runMigrations(db)).resolves.toBeUndefined();
    expect(db.tableNames().filter((n) => EXPECTED_TABLES.includes(n)).length).toBe(EXPECTED_TABLES.length);
    _resetDbForTests();
    await expect(runMigrations(await getDb())).resolves.toBeUndefined();
  });
});

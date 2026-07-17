import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppSettings, SettingsPatch } from '../../src/lib/schemas/settings';
import { cleanTables, setupTestDb, teardownTestDb } from '../helpers/p4';

let materialize: () => Promise<{ created: number }>;
let callTool: (name: string, params: unknown, context: { actor: string }) => Promise<unknown>;
let getSettings: () => Promise<AppSettings>;
let updateSettings: (patch: SettingsPatch) => Promise<AppSettings>;

const CHECKLIST = [
  {
    key: 'transcript',
    title: 'Send final high-school transcript',
    category: 'transcript' as const,
    due_at: '2026-08-01',
  },
  {
    key: 'vaccine',
    title: 'Submit immunization records',
    category: 'vaccine' as const,
    due_at: null,
  },
];

beforeAll(async () => {
  await setupTestDb();
  ({ materializePendingChecklist: materialize } = await import('../../src/server/tools/tasks'));
  ({ callTool } = await import('../../src/server/tools/call'));
  ({ getSettings, updateSettings } = await import('../../src/server/settings'));
});
beforeEach(async () => {
  await cleanTables();
  await updateSettings({
    wizard_state: {
      completed: false,
      skipped_steps: [],
      current_step: 8,
      pending_checklist: CHECKLIST,
    },
  });
});
afterAll(teardownTestDb);

describe('materializePendingChecklist', () => {
  it('creates wizard tasks and marks entries materialized', async () => {
    expect((await materialize()).created).toBe(2);
    const tasks = await callTool('list_tasks', {}, { actor: 'test' }) as Array<{
      source: string;
      category: string;
      due_at: string | null;
    }>;
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.source === 'wizard')).toBe(true);
    expect(tasks.find((task) => task.category === 'transcript')?.due_at)
      .toBe('2026-08-01T23:59:59.999Z');
    const checklist = (await getSettings()).wizard_state.pending_checklist;
    expect(checklist?.every((entry) => entry.materialized === true)).toBe(true);
  });

  it('creates nothing on a second run', async () => {
    await materialize();
    expect((await materialize()).created).toBe(0);
    expect(await callTool('list_tasks', {}, { actor: 'test' }) as unknown[]).toHaveLength(2);
  });

  it('no-ops when pending_checklist has no entries', async () => {
    await updateSettings({
      wizard_state: {
        completed: true,
        skipped_steps: [],
        current_step: 10,
        pending_checklist: [],
      },
    });
    expect((await materialize()).created).toBe(0);
  });
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dataDir = mkdtempSync(join(tmpdir(), 'redi-p3-reg-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_MODE = 'embedded';
process.env.MONGRELDB_PASSPHRASE = 'test-passphrase';
process.env.MONGRELDB_DB_USERNAME = 'redi';
process.env.MONGRELDB_DB_PASSWORD = 'test-password';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeWindow } from '../../src/server/degree/progress';
import type { Tool } from '../../src/server/tools/registry';
import { seedCourse, seedProgram, seedTerm } from '../helpers/degree';
import { updateRow, type TermRow } from '../../src/server/degree/repo';

const term = (over: Partial<TermRow>): TermRow => ({
  id: 't', name: 'Fall 2026', classes_start: '2026-08-24', classes_end: '2026-12-11',
  registration_opens_at: null, registration_closes_at: null, add_drop_deadline: null,
  tuition_due: null, notes: null, ...over,
});

describe('computeWindow', () => {
  const now = new Date('2026-03-15T12:00:00.000Z');
  it('classifies window states', () => {
    expect(computeWindow(term({}), now).state).toBe('not_scheduled');
    const upcoming = computeWindow(term({ registration_opens_at: '2026-04-01T13:00:00.000Z', registration_closes_at: '2026-04-30T13:00:00.000Z' }), now);
    expect(upcoming.state).toBe('upcoming');
    expect(upcoming.days_until_open).toBe(18);
    const open = computeWindow(term({ registration_opens_at: '2026-03-01T13:00:00.000Z', registration_closes_at: '2026-03-20T13:00:00.000Z' }), now);
    expect(open.state).toBe('open');
    expect(open.days_until_close).toBe(6);
    expect(computeWindow(term({ registration_opens_at: '2026-03-01T13:00:00.000Z' }), now).state).toBe('open');
    expect(computeWindow(term({ registration_opens_at: '2026-02-01T13:00:00.000Z', registration_closes_at: '2026-03-01T13:00:00.000Z' }), now).state).toBe('closed');
  });
});

describe('get_registration_status tool', () => {
  let tools: Tool<any, any>[];
  const call = (name: string, params: unknown) => tools.find((t) => t.name === name)!.handler({ actor: 'test' }, params);
  beforeAll(async () => {
    process.env.DATA_DIR = dataDir;
    const { _resetDbForTests } = await import('../../src/server/db/client');
    const { _resetConfigForTests } = await import('../../src/server/config');
    _resetDbForTests();
    _resetConfigForTests();
    const { runMigrations } = await import('../../src/server/db/migrate');
    const { degreeTools } = await import('../../src/server/tools/degree');
    await runMigrations();
    tools = degreeTools;
  });
  afterAll(async () => {
    const { _resetDbForTests } = await import('../../src/server/db/client');
    _resetDbForTests();
  });
  it('returns empty shape when no terms exist', async () => {
    const out = await call('get_registration_status', {}) as { term: unknown; unregistered_count: number };
    expect(out.term).toBeNull();
    expect(out.unregistered_count).toBe(0);
  });
  it('picks the nearest upcoming term by default and lists per-course status', async () => {
    await seedTerm('Fall 2020', '2020-08-24', '2020-12-11');
    const tid = await seedTerm('Fall 2026', '2026-08-24', '2026-12-11');
    const pid = await seedProgram();
    const c1 = await seedCourse(pid, 'CS 201');
    const c2 = await seedCourse(pid, 'HUM 210', { credits: 3 });
    await call('plan_course', { program_id: pid, course_id: c1, term_id: tid });
    const p2 = await call('plan_course', { program_id: pid, course_id: c2, term_id: tid }) as { id: string };
    await call('update_planned_course', { id: p2.id, status: 'registered' });
    const out = await call('get_registration_status', {}) as {
      term: { id: string; name: string };
      planned_courses: Array<{ course_code: string; status: string }>;
      unregistered_count: number;
    };
    expect(out.term.id).toBe(tid);
    expect(out.planned_courses.length).toBe(2);
    expect(out.unregistered_count).toBe(1);
    expect(out.planned_courses.find((c) => c.course_code === 'HUM 210')?.status).toBe('registered');
  });
  it('honors an explicit term_id and reflects window dates', async () => {
    const tid = await seedTerm('Spring 2027', '2027-01-11', '2027-05-01');
    await updateRow('terms', tid, { registration_opens_at: '2026-11-01T13:00:00.000Z', registration_closes_at: '2026-12-01T13:00:00.000Z' });
    const out = await call('get_registration_status', { term_id: tid }) as {
      term: { name: string };
      window: { state: string; opens_at: string };
    };
    expect(out.term.name).toBe('Spring 2027');
    expect(out.window.opens_at).toBe('2026-11-01T13:00:00.000Z');
    expect(['upcoming', 'open', 'closed']).toContain(out.window.state);
  });
  it('errors on unknown term_id', async () => {
    await expect(call('get_registration_status', { term_id: crypto.randomUUID() })).rejects.toMatchObject({ code: 'not_found' });
  });
});

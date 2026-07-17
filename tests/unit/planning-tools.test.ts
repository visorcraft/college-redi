import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'redi-p3-plan-'));
process.env.DATABASE_MODE = 'embedded';
process.env.MONGRELDB_PASSPHRASE = 'test-passphrase';
process.env.MONGRELDB_DB_USERNAME = 'redi';
process.env.MONGRELDB_DB_PASSWORD = 'test-password';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tool } from '../../src/server/tools/registry';
import { seedCourse, seedProgram, seedTerm } from '../helpers/degree';

let tools: Tool[];
const dataDir = process.env.DATA_DIR!;
const call = (name: string, params: unknown) => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool.handler({ actor: 'test' }, params);
};

beforeAll(async () => {
  process.env.DATA_DIR = dataDir;
  const { _resetDbForTests } = await import('../../src/server/db/client');
  const { _resetConfigForTests } = await import('../../src/server/config');
  _resetDbForTests();
  _resetConfigForTests();
  const { runMigrations } = await import('../../src/server/db/migrate');
  const { degreeTools } = await import('../../src/server/tools/degree');
  const { termsTools } = await import('../../src/server/tools/terms');
  await runMigrations();
  tools = [...degreeTools, ...termsTools];
});
afterAll(async () => {
  const { _resetDbForTests } = await import('../../src/server/db/client');
  _resetDbForTests();
});

describe('mark/unmark_course_completed', () => {
  it('records completion with course defaults and upserts on the unique key', async () => {
    const pid = await seedProgram();
    const cid = await seedCourse(pid, 'CS 101', { credits: 4 });
    const otherPid = await seedProgram({ name: 'Other program' });
    const otherCourse = await seedCourse(otherPid, 'BIO 101');
    const row = await call('mark_course_completed', { program_id: pid, course_id: cid, term: 'Fall 2024', year: 2024, grade: 'a-' }) as { id: string; credits: number; status: string; source: string };
    expect(row.credits).toBe(4);
    expect(row.status).toBe('completed');
    expect(row.source).toBe('manual');
    const again = await call('mark_course_completed', { program_id: pid, course_id: cid, term: 'Fall 2024', year: 2024, grade: 'A' }) as { id: string; grade: string };
    expect(again.id).toBe(row.id);
    expect(again.grade).toBe('A');
    await expect(call('mark_course_completed', { program_id: pid, course_id: crypto.randomUUID(), term: 'Fall 2024', year: 2024 })).rejects.toMatchObject({ code: 'not_found' });
    await expect(call('mark_course_completed', { program_id: pid, course_id: otherCourse, term: 'Fall 2024', year: 2024 })).rejects.toMatchObject({ code: 'conflict' });
    await call('unmark_course_completed', { id: row.id });
    await expect(call('unmark_course_completed', { id: row.id })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('records transfer and in_progress statuses', async () => {
    const pid = await seedProgram();
    const cid = await seedCourse(pid, 'HUM 100');
    const t = await call('mark_course_completed', { program_id: pid, course_id: cid, term: 'Fall 2023', year: 2023, status: 'transfer', grade: 'T', credits: 3, source: 'import' }) as { status: string };
    expect(t.status).toBe('transfer');
    const ip = await call('mark_course_completed', { program_id: pid, course_id: cid, term: 'Fall 2025', year: 2025, status: 'in_progress' }) as { status: string; grade: string | null };
    expect(ip.status).toBe('in_progress');
    expect(ip.grade).toBeNull();
  });
});

describe('plan/update/remove planned courses', () => {
  it('plans, enforces uniqueness + FKs, updates status, removes with confirm', async () => {
    const pid = await seedProgram();
    const cid = await seedCourse(pid, 'CS 201');
    const otherPid = await seedProgram({ name: 'Other plan' });
    const otherCourse = await seedCourse(otherPid, 'BIO 201');
    const tid = await seedTerm('Fall 2026');
    const planned = await call('plan_course', { program_id: pid, course_id: cid, term_id: tid, section: 'A01' }) as { id: string; status: string };
    expect(planned.status).toBe('planned');
    await expect(call('plan_course', { program_id: pid, course_id: cid, term_id: tid })).rejects.toMatchObject({ code: 'conflict' });
    await expect(call('plan_course', { program_id: pid, course_id: cid, term_id: crypto.randomUUID() })).rejects.toMatchObject({ code: 'not_found' });
    await expect(call('plan_course', { program_id: pid, course_id: otherCourse, term_id: tid })).rejects.toMatchObject({ code: 'conflict' });
    const updated = await call('update_planned_course', { id: planned.id, status: 'registered', section: 'B02' }) as { status: string; section: string };
    expect(updated.status).toBe('registered');
    expect(updated.section).toBe('B02');
    await expect(call('update_planned_course', { id: planned.id, status: 'enrolled' })).rejects.toMatchObject({ name: 'ZodError' });
    await expect(call('remove_planned_course', { id: planned.id })).rejects.toMatchObject({ code: 'confirm_required' });
    await call('remove_planned_course', { id: planned.id, confirm: true });
    await expect(call('update_planned_course', { id: planned.id, status: 'dropped' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('terms tools', () => {
  it('upserts by name, lists ordered, and blocks delete when referenced', async () => {
    const created = await call('upsert_term', { name: 'Fall 2026', classes_start: '2026-08-24', classes_end: '2026-12-11', registration_opens_at: '2026-04-01T13:00:00.000Z' }) as { id: string; registration_opens_at: string };
    expect(created.registration_opens_at).toBe('2026-04-01T13:00:00.000Z');
    const upserted = await call('upsert_term', { name: 'Fall 2026', classes_start: '2026-08-25', classes_end: '2026-12-11' }) as { id: string; classes_start: string };
    expect(upserted.id).toBe(created.id);
    expect(upserted.classes_start).toBe('2026-08-25');
    await call('upsert_term', { name: 'Spring 2026', classes_start: '2026-01-12', classes_end: '2026-05-01' });
    const names = (await call('list_terms', {}) as Array<{ name: string }>).map((t) => t.name);
    expect(names.indexOf('Spring 2026')).toBeLessThan(names.indexOf('Fall 2026'));
    const clash = await call('upsert_term', { name: 'Other', classes_start: '2027-01-01', classes_end: '2027-05-01' }) as { id: string };
    await expect(call('upsert_term', { id: clash.id, name: 'Fall 2026', classes_start: '2027-01-01', classes_end: '2027-05-01' })).rejects.toMatchObject({ code: 'conflict' });
    const pid = await seedProgram();
    const cid = await seedCourse(pid, 'CS 101');
    await call('plan_course', { program_id: pid, course_id: cid, term_id: created.id });
    await expect(call('delete_term', { id: created.id, confirm: true })).rejects.toMatchObject({ code: 'conflict' });
    await expect(call('delete_term', { id: clash.id })).rejects.toMatchObject({ code: 'confirm_required' });
    await call('delete_term', { id: clash.id, confirm: true });
    await expect(call('upsert_term', { id: clash.id, name: 'Gone', classes_start: '2027-01-01', classes_end: '2027-05-01' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'redi-p3-degtools-'));
process.env.DATABASE_MODE = 'embedded';
process.env.MONGRELDB_PASSPHRASE = 'test-passphrase';
process.env.MONGRELDB_DB_USERNAME = 'redi';
process.env.MONGRELDB_DB_PASSWORD = 'test-password';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tool } from '../../src/server/tools/registry';
import { seedCourse, seedProgram, seedRequirement, seedTerm } from '../helpers/degree';

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
  await runMigrations();
  tools = degreeTools;
});
afterAll(async () => {
  const { _resetDbForTests } = await import('../../src/server/db/client');
  _resetDbForTests();
});

describe('registry shape', () => {
  it('exposes the §9 degree tool names with side-effect levels', () => {
    const names = tools.map((t) => t.name);
    for (const n of ['list_programs', 'get_program', 'create_program', 'update_program', 'delete_program',
      'list_requirements', 'add_requirement', 'update_requirement', 'delete_requirement',
      'list_courses', 'add_course', 'update_course', 'delete_course',
      'mark_course_completed', 'unmark_course_completed',
      'plan_course', 'update_planned_course', 'remove_planned_course']) {
      expect(names).toContain(n);
    }
    for (const n of ['delete_program', 'delete_requirement', 'delete_course', 'remove_planned_course']) {
      expect(tools.find((t) => t.name === n)?.sideEffect).toBe('destructive');
    }
    for (const t of tools) expect(t.jsonSchema).toBeTypeOf('object');
  });
});

describe('program tools', () => {
  it('creates, reads, updates, lists, and deletes a program', async () => {
    const created = await call('create_program', { name: 'BS CS', institution: 'State University', total_credits_required: 120, gpa_requirement: 2.0 }) as { id: string; status: string; source: string };
    expect(created.status).toBe('active');
    expect(created.source).toBe('manual');
    const fetched = await call('get_program', { id: created.id }) as { id: string };
    expect(fetched.id).toBe(created.id);
    const updated = await call('update_program', { id: created.id, total_credits_required: 128 }) as { total_credits_required: number };
    expect(updated.total_credits_required).toBe(128);
    const list = await call('list_programs', {}) as unknown[];
    expect(list.some((p) => (p as { id: string }).id === created.id)).toBe(true);
    await expect(call('delete_program', { id: created.id })).rejects.toMatchObject({ code: 'confirm_required' });
    await expect(call('delete_program', { id: created.id, confirm: true })).resolves.toMatchObject({ deleted: true });
    await expect(call('get_program', { id: created.id })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('delete_program cascades dependent rows', async () => {
    const pid = await seedProgram();
    const cid = await seedCourse(pid, 'CS 101');
    await seedRequirement(pid, { type: 'course', course_id: cid });
    const tid = await seedTerm('Fall 2026');
    await call('plan_course', { program_id: pid, course_id: cid, term_id: tid });
    await call('mark_course_completed', { program_id: pid, course_id: cid, term: 'Fall 2024', year: 2024, grade: 'A' });
    await call('delete_program', { id: pid, confirm: true });
    const { sqlOne } = await import('../../src/server/degree/repo');
    expect(await sqlOne(`SELECT id FROM courses WHERE program_id = '${pid}'`)).toBeNull();
    expect(await sqlOne(`SELECT id FROM requirements WHERE program_id = '${pid}'`)).toBeNull();
    expect(await sqlOne(`SELECT id FROM completed_courses WHERE program_id = '${pid}'`)).toBeNull();
    expect(await sqlOne(`SELECT id FROM planned_courses WHERE program_id = '${pid}'`)).toBeNull();
  });
});

describe('requirement tools', () => {
  it('enforces type-specific shape rules', async () => {
    const pid = await seedProgram();
    await expect(call('add_requirement', { program_id: pid, type: 'course', group_name: 'Core' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(call('add_requirement', { program_id: pid, type: 'credit_bucket', group_name: 'Hum', credits_required: 6 })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(call('add_requirement', { program_id: pid, type: 'course', course_id: crypto.randomUUID(), group_name: 'Core' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(call('add_requirement', { program_id: crypto.randomUUID(), type: 'milestone', group_name: 'X' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('adds, orders, updates, and deletes requirements', async () => {
    const pid = await seedProgram();
    const cid = await seedCourse(pid, 'CS 101');
    const r1 = await call('add_requirement', { program_id: pid, type: 'course', course_id: cid, group_name: 'Core', min_grade: 'C' }) as { id: string; sort_order: number };
    const r2 = await call('add_requirement', { program_id: pid, type: 'credit_bucket', group_name: 'Humanities', credits_required: 6, bucket_rule: { subjects: ['HUM', 'PHIL'] } }) as { id: string; sort_order: number };
    expect(r2.sort_order).toBeGreaterThan(r1.sort_order);
    const list = await call('list_requirements', { program_id: pid }) as Array<{ id: string; bucket_rule: unknown }>;
    expect(list.map((r) => r.id)).toEqual([r1.id, r2.id]);
    expect(list[1].bucket_rule).toEqual({ subjects: ['HUM', 'PHIL'] });
    const updated = await call('update_requirement', { id: r2.id, credits_required: 9 }) as { credits_required: number };
    expect(updated.credits_required).toBe(9);
    await expect(call('update_requirement', { id: r1.id, type: 'credit_bucket' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(call('delete_requirement', { id: r2.id })).rejects.toMatchObject({ code: 'confirm_required' });
    await call('delete_requirement', { id: r2.id, confirm: true });
    expect((await call('list_requirements', { program_id: pid }) as unknown[]).length).toBe(1);
  });
});

describe('course tools', () => {
  it('normalizes codes, derives subject, and enforces (program_id, code) uniqueness', async () => {
    const pid = await seedProgram();
    const c = await call('add_course', { program_id: pid, code: 'cs101', title: 'Intro to CS', credits: 4, prerequisites: ['math 151'] }) as { id: string; code: string; subject: string; prerequisites: string[] };
    expect(c.code).toBe('CS 101');
    expect(c.subject).toBe('CS');
    expect(c.prerequisites).toEqual(['MATH 151']);
    await expect(call('add_course', { program_id: pid, code: 'CS 101', title: 'Dup', credits: 3 })).rejects.toMatchObject({ code: 'conflict' });
    await expect(call('add_course', { program_id: crypto.randomUUID(), code: 'BIO 110', title: 'Bio', credits: 4 })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('updates and re-checks uniqueness on code change', async () => {
    const pid = await seedProgram();
    await seedCourse(pid, 'CS 201');
    const c = await call('add_course', { program_id: pid, code: 'CS 101', title: 'Intro', credits: 4 }) as { id: string };
    await expect(call('update_course', { id: c.id, code: 'cs 201' })).rejects.toMatchObject({ code: 'conflict' });
    const updated = await call('update_course', { id: c.id, code: 'cs 150', credits: 3 }) as { code: string; subject: string; credits: number };
    expect(updated.code).toBe('CS 150');
    expect(updated.subject).toBe('CS');
    expect(updated.credits).toBe(3);
  });

  it('blocks delete_course while referenced and deletes after refs are gone', async () => {
    const pid = await seedProgram();
    const cid = await seedCourse(pid, 'CS 101');
    await call('mark_course_completed', { program_id: pid, course_id: cid, term: 'Fall 2024', year: 2024 });
    await expect(call('delete_course', { id: cid, confirm: true })).rejects.toMatchObject({ code: 'conflict' });
    const done = await call('list_courses', { program_id: pid }) as Array<{ id: string }>;
    expect(done.length).toBe(1);
    const { sqlOne } = await import('../../src/server/degree/repo');
    const row = await sqlOne<{ id: string }>(`SELECT id FROM completed_courses WHERE course_id = '${cid}'`);
    await call('unmark_course_completed', { id: row!.id });
    await expect(call('delete_course', { id: cid })).rejects.toMatchObject({ code: 'confirm_required' });
    await call('delete_course', { id: cid, confirm: true });
    expect((await call('list_courses', { program_id: pid }) as unknown[]).length).toBe(0);
  });
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'redi-p3-int-'));
process.env.DATABASE_MODE = 'embedded';
process.env.MONGRELDB_PASSPHRASE = 'test-passphrase';
process.env.MONGRELDB_DB_USERNAME = 'redi';
process.env.MONGRELDB_DB_PASSWORD = 'test-password';
const dataDir = process.env.DATA_DIR;

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type Route = Partial<Record<'GET' | 'POST' | 'PATCH' | 'DELETE', (...args: any[]) => Promise<Response>>>;
const routes: Record<string, Route> = {};
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const json = (method: string, body: unknown, url = 'http://test/api/x') =>
  new Request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  const { _resetDbForTests } = await import('../../src/server/db/client');
  const { _resetConfigForTests } = await import('../../src/server/config');
  const { _resetRegistryForTests } = await import('../../src/server/tools/registry');
  const { _resetToolsForTests } = await import('../../src/server/tools');
  _resetDbForTests();
  _resetConfigForTests();
  _resetRegistryForTests();
  _resetToolsForTests();
  process.env.DATA_DIR = dataDir;
  delete process.env.MONGRELDB_PATH;
  vi.resetModules();
  const { runMigrations } = await import('../../src/server/db/migrate');
  const { registerAllTools } = await import('../../src/server/tools');
  await runMigrations();
  registerAllTools();
  routes.programs = await import('../../src/app/api/programs/route');
  routes.program = await import('../../src/app/api/programs/[id]/route');
  routes.requirements = await import('../../src/app/api/requirements/route');
  routes.requirement = await import('../../src/app/api/requirements/[id]/route');
  routes.courses = await import('../../src/app/api/courses/route');
  routes.course = await import('../../src/app/api/courses/[id]/route');
  routes.completed = await import('../../src/app/api/completed-courses/route');
  routes.completedOne = await import('../../src/app/api/completed-courses/[id]/route');
  routes.terms = await import('../../src/app/api/terms/route');
  routes.term = await import('../../src/app/api/terms/[id]/route');
  routes.planned = await import('../../src/app/api/planned-courses/route');
  routes.plannedOne = await import('../../src/app/api/planned-courses/[id]/route');
  routes.progress = await import('../../src/app/api/progress/route');
});

afterAll(async () => {
  const { _resetDbForTests } = await import('../../src/server/db/client');
  _resetDbForTests();
});

describe('programs CRUD + error envelope', () => {
  it('creates, lists, patches, and deletes with confirm', async () => {
    const created = await (await routes.programs.POST!(json('POST', {
      name: 'BS CS', institution: 'State U', total_credits_required: 120,
    }))).json();
    expect(created.id).toBeTruthy();
    const list = await (await routes.programs.GET!(new Request('http://test/api/programs'))).json();
    expect(list.length).toBe(1);
    const patched = await (await routes.program.PATCH!(
      json('PATCH', { name: 'BS Computer Science' }),
      ctx({ id: created.id }),
    )).json();
    expect(patched.name).toBe('BS Computer Science');
    const noConfirm = await routes.program.DELETE!(json('DELETE', {}, 'http://test/api/programs/x'), ctx({ id: created.id }));
    expect(noConfirm.status).toBe(400);
    expect((await noConfirm.json()).error.code).toBe('confirm_required');
    await routes.program.DELETE!(json('DELETE', { confirm: true }), ctx({ id: created.id }));
    const missing = await routes.program.GET!(new Request('http://test/api/programs/x'), ctx({ id: created.id }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('not_found');
  });

  it('returns 400 with validation code on bad body', async () => {
    const res = await routes.programs.POST!(json('POST', { name: '' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
  });
});

describe('requirements + courses', () => {
  it('runs the full requirement/course lifecycle with conflicts', async () => {
    const program = await (await routes.programs.POST!(json('POST', {
      name: 'P', institution: 'U', total_credits_required: 60,
    }))).json();
    const badReq = await routes.requirements.POST!(json('POST', {
      program_id: program.id, type: 'credit_bucket', group_name: 'Hum', credits_required: 6,
    }));
    expect(badReq.status).toBe(400);
    const course = await (await routes.courses.POST!(json('POST', {
      program_id: program.id, code: 'hum 210', title: 'Ethics', credits: 3,
    }))).json();
    expect(course.code).toBe('HUM 210');
    const dup = await routes.courses.POST!(json('POST', {
      program_id: program.id, code: 'HUM 210', title: 'Dup', credits: 3,
    }));
    expect(dup.status).toBe(409);
    const req = await (await routes.requirements.POST!(json('POST', {
      program_id: program.id, type: 'course', course_id: course.id, group_name: 'Core', min_grade: 'C',
    }))).json();
    const reqList = await (await routes.requirements.GET!(
      new Request(`http://test/api/requirements?program_id=${program.id}`),
    )).json();
    expect(reqList.length).toBe(1);
    await routes.requirement.PATCH!(json('PATCH', { min_grade: 'B' }), ctx({ id: req.id }));
    const blocked = await routes.course.DELETE!(json('DELETE', { confirm: true }), ctx({ id: course.id }));
    expect(blocked.status).toBe(409);
    await routes.requirement.DELETE!(json('DELETE', { confirm: true }), ctx({ id: req.id }));
    const ok = await routes.course.DELETE!(json('DELETE', { confirm: true }), ctx({ id: course.id }));
    expect(ok.status).toBe(200);
  });
});

describe('completed + planned + terms + progress', () => {
  it('covers the whole planning flow end to end', async () => {
    const program = await (await routes.programs.POST!(json('POST', {
      name: 'P2', institution: 'U', total_credits_required: 12,
    }))).json();
    const course = await (await routes.courses.POST!(json('POST', {
      program_id: program.id, code: 'CS 101', title: 'Intro', credits: 4,
    }))).json();
    await routes.requirements.POST!(json('POST', {
      program_id: program.id, type: 'course', course_id: course.id, group_name: 'Core',
    }));
    const term = await (await routes.terms.POST!(json('POST', {
      name: 'Fall 2026', classes_start: '2026-08-24', classes_end: '2026-12-11',
    }))).json();
    const planned = await (await routes.planned.POST!(json('POST', {
      program_id: program.id, course_id: course.id, term_id: term.id,
    }))).json();
    const perTerm = await (await routes.planned.GET!(
      new Request(`http://test/api/planned-courses?program_id=${program.id}&term_id=${term.id}`),
    )).json();
    expect(perTerm.unregistered_count).toBe(1);
    expect(perTerm.window.state).toBe('not_scheduled');
    await routes.plannedOne.PATCH!(json('PATCH', { status: 'registered' }), ctx({ id: planned.id }));
    const flat = await (await routes.planned.GET!(
      new Request(`http://test/api/planned-courses?program_id=${program.id}`),
    )).json();
    expect(flat[0].status).toBe('registered');
    const progress = await (await routes.progress.GET!(
      new Request(`http://test/api/progress?program_id=${program.id}`),
    )).json();
    expect(progress.requirements_met).toBe(false);
    expect(progress.projected_graduation_term).toBe('Fall 2026');
    const done = await (await routes.completed.POST!(json('POST', {
      program_id: program.id, course_id: course.id, term: 'Fall 2024', year: 2024, grade: 'A',
    }))).json();
    const doneList = await (await routes.completed.GET!(
      new Request(`http://test/api/completed-courses?program_id=${program.id}`),
    )).json();
    expect(doneList.length).toBe(1);
    expect(doneList[0].course_code).toBe('CS 101');
    await routes.completedOne.DELETE!(
      new Request('http://test/api/completed-courses/x', { method: 'DELETE' }),
      ctx({ id: done.id }),
    );
    const after = await (await routes.completed.GET!(
      new Request(`http://test/api/completed-courses?program_id=${program.id}`),
    )).json();
    expect(after.length).toBe(0);
    await routes.plannedOne.DELETE!(json('DELETE', { confirm: true }), ctx({ id: planned.id }));
    await routes.term.DELETE!(json('DELETE', { confirm: true }), ctx({ id: term.id }));
    const termsLeft = await (await routes.terms.GET!(new Request('http://test/api/terms'))).json();
    expect(termsLeft.some((t: { id: string }) => t.id === term.id)).toBe(false);
  });
});

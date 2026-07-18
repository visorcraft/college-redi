import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'redi-p3-int-import-'));
process.env.DATABASE_MODE = 'embedded';
process.env.MONGRELDB_PASSPHRASE = 'test-passphrase';
process.env.MONGRELDB_DB_USERNAME = 'redi';
process.env.MONGRELDB_DB_PASSWORD = 'test-password';

import { beforeAll, describe, expect, it, vi } from 'vitest';

const draftJson = {
  program: {
    name: 'BS Computer Science',
    institution: 'State University',
    catalog_year: '2024',
    total_credits_required: 120,
    gpa_requirement: 2.0,
  },
  courses: [
    { code: 'CS 101', title: 'Intro to CS', credits: 4 },
    { code: 'HUM 210', title: 'Ethics', credits: 3 },
  ],
  requirements: [
    { type: 'course', course_code: 'CS 101', group_name: 'Core' },
    {
      type: 'credit_bucket',
      credits_required: 3,
      bucket_rule: { subjects: ['HUM'] },
      group_name: 'Humanities',
    },
  ],
  completed_courses: [
    {
      course_code: 'CS 101',
      term: 'Fall 2024',
      year: 2024,
      grade: 'A',
      credits: 4,
      status: 'completed',
    },
  ],
  confidence_flags: [{ path: 'requirements[1]', message: 'bucket rule guessed from prose' }],
};

vi.mock('../../src/server/ai/client', () => ({
  getAiClient: async () => ({
    model: 'test-model',
    effort: 'low',
    client: {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: JSON.stringify(draftJson) } }] }),
        },
      },
    },
  }),
}));

type Route = Partial<Record<'GET' | 'POST', (req: Request) => Promise<Response>>>;
const routes: Record<string, Route> = {};
const json = (method: string, body: unknown) =>
  new Request('http://test/api/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const { runMigrations } = await import('../../src/server/db/migrate');
  const { _resetRegistryForTests } = await import('../../src/server/tools/registry');
  const { _resetToolsForTests, registerAllTools } = await import('../../src/server/tools');
  await runMigrations();
  _resetRegistryForTests();
  _resetToolsForTests();
  registerAllTools();
  routes.programsImport = await import('../../src/app/api/programs/import/route');
  routes.importConfirm = await import('../../src/app/api/programs/import/confirm/route');
  routes.progress = await import('../../src/app/api/progress/route');
});

describe('import routes', () => {
  it('parses pasted text into a draft and confirms it', async () => {
    const draftRes = await routes.programsImport.POST!(
      json('POST', { text: 'BS Computer Science, 120 credits...' }),
    );
    expect(draftRes.status).toBe(200);
    const parsed = await draftRes.json();
    expect(parsed.ok).toBe(true);
    expect(parsed.draft.confidence_flags.length).toBe(1);
    const confirm = await routes.importConfirm.POST!(json('POST', { draft: parsed.draft }));
    expect(confirm.status).toBe(200);
    const result = await confirm.json();
    expect(result.program_id).toBeTruthy();
    expect(result.courses_created).toBe(2);
    const progressResponse = await routes.progress.GET!(
      new Request(`http://test/api/progress?program_id=${result.program_id}`),
    );
    const progress = await progressResponse.json();
    expect(progress.credits_completed).toBe(4);
    expect(progress.requirements.find((requirement: { type: string }) =>
      requirement.type === 'course').satisfied).toBe(true);
  });

  it('accepts multipart file upload', async () => {
    const form = new FormData();
    form.append('file', new Blob(['plain text audit'], { type: 'text/plain' }), 'audit.txt');
    const res = await routes.programsImport.POST!(
      new Request('http://test/api/programs/import', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('rejects oversized and unsupported multipart uploads', async () => {
    const oversized = await routes.programsImport.POST!(
      new Request('http://test/api/programs/import', {
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=test',
          'content-length': String(11 * 1024 * 1024),
        },
        body: '--test--',
      }),
    );
    expect(oversized.status).toBe(413);

    const form = new FormData();
    form.append('file', new Blob(['<html>bad</html>'], { type: 'text/html' }), 'audit.html');
    const unsupported = await routes.programsImport.POST!(
      new Request('http://test/api/programs/import', { method: 'POST', body: form }),
    );
    expect(unsupported.status).toBe(400);
  });
});

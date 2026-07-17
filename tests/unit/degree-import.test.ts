import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'redi-p3-import-'));
process.env.DATABASE_MODE = 'embedded';
process.env.MONGRELDB_PASSPHRASE = 'test-passphrase';
process.env.MONGRELDB_DB_USERNAME = 'redi';
process.env.MONGRELDB_DB_PASSWORD = 'test-password';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { Tool } from '../../src/server/tools/registry';

const draftOk = {
  program: {
    name: 'BS Computer Science',
    institution: 'State University',
    catalog_year: '2024-2025',
    total_credits_required: 120,
    gpa_requirement: 2.0,
  },
  courses: [
    { code: 'CS 101', title: 'Introduction to Computer Science', credits: 4 },
    { code: 'CS 201', title: 'Data Structures', credits: 4, prerequisites: ['CS 101'] },
    { code: 'MATH 151', title: 'Calculus I', credits: 4 },
  ],
  requirements: [
    { type: 'course', course_code: 'CS 101', group_name: 'Core' },
    { type: 'course', course_code: 'CS 201', group_name: 'Core' },
    {
      type: 'credit_bucket',
      credits_required: 6,
      bucket_rule: { subjects: ['HUM', 'PHIL'], number_ranges: [{ min: 100, max: 499 }] },
      group_name: 'Humanities Electives',
    },
    { type: 'gpa', group_name: 'Minimum GPA' },
  ],
  completed_courses: [
    { course_code: 'CS 101', term: 'Fall 2024', year: 2024, grade: 'A', credits: 4, status: 'completed' },
    { course_code: 'CS 201', term: 'Fall 2025', year: 2025, credits: 4, status: 'in_progress' },
  ],
  confidence_flags: [],
};

const createMock = vi.fn();
vi.mock('../../src/server/ai/client', () => ({
  getAiClient: async () => ({
    model: 'test-model',
    effort: 'medium',
    client: { chat: { completions: { create: createMock } } },
  }),
  AiNotConfiguredError: class AiNotConfiguredError extends Error {},
}));

let importModule: typeof import('../../src/server/ai/import');
let tools: Tool[];
const call = (name: string, params: unknown) =>
  tools.find((tool) => tool.name === name)!.handler({ actor: 'test' }, params);

beforeAll(async () => {
  const { runMigrations } = await import('../../src/server/db/migrate');
  const { degreeTools } = await import('../../src/server/tools/degree');
  importModule = await import('../../src/server/ai/import');
  await runMigrations();
  tools = degreeTools;
});
beforeEach(() => createMock.mockReset());

describe('extractAuditText', () => {
  it('returns pasted text directly and decodes base64 txt', async () => {
    expect(await importModule.extractAuditText({ text: 'hello audit' })).toBe('hello audit');
    const b64 = Buffer.from('plain audit file', 'utf8').toString('base64');
    expect(await importModule.extractAuditText({ file_base64: b64, filename: 'audit.txt' })).toBe('plain audit file');
  });

  it('extracts text from a real PDF', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText('CS 101 Introduction to Computer Science 4 credits', {
      x: 50,
      y: 700,
      size: 12,
      font: await doc.embedFont(StandardFonts.Helvetica),
    });
    const bytes = await doc.save();
    const text = await importModule.extractAuditText({
      file_base64: Buffer.from(bytes).toString('base64'),
      filename: 'audit.pdf',
    });
    expect(text).toContain('CS 101');
  });
});

describe('runDegreeImport', () => {
  const auditText = readFileSync(join(__dirname, '../fixtures/degree-audit-1.txt'), 'utf8');

  it('parses valid AI JSON into a validated draft', async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(draftOk) } }] });
    const result = await importModule.runDegreeImport(auditText);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.program.total_credits_required).toBe(120);
      expect(result.draft.requirements.length).toBe(4);
    }
  });

  it('retries once with validation errors appended, then succeeds', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"program":{"name":1}}' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(draftOk) } }] });
    const result = await importModule.runDegreeImport(auditText);
    expect(result.ok).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(2);
    const secondCall = createMock.mock.calls[1][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(secondCall.messages.length).toBe(3);
    expect(secondCall.messages[2].content).toContain('failed validation');
  });

  it('fails gracefully after two invalid attempts', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: 'not json at all' } }] });
    const result = await importModule.runDegreeImport(auditText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('manually');
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

describe('import_degree_audit + confirm_degree_import tools', () => {
  it('are registered as write tools', () => {
    expect(tools.find((tool) => tool.name === 'import_degree_audit')?.sideEffect).toBe('write');
    expect(tools.find((tool) => tool.name === 'confirm_degree_import')?.sideEffect).toBe('write');
  });

  it('import returns a draft and persists nothing', async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(draftOk) } }] });
    const result = await call('import_degree_audit', { text: 'audit text' }) as { ok: boolean; draft: unknown };
    expect(result.ok).toBe(true);
    const { sqlAll } = await import('../../src/server/degree/repo');
    const programs = await sqlAll('SELECT id FROM degree_programs');
    expect(programs.length).toBe(0);
  });

  it('confirm writes all records transactionally with source=import', async () => {
    const result = await call('confirm_degree_import', { draft: draftOk }) as {
      program_id: string;
      courses_created: number;
      requirements_created: number;
      completed_created: number;
      warnings: string[];
    };
    expect(result.courses_created).toBe(3);
    expect(result.requirements_created).toBe(4);
    expect(result.completed_created).toBe(2);
    const progress = await call('get_degree_progress', { program_id: result.program_id }) as {
      credits_completed: number;
      credits_in_progress: number;
      gpa: number;
      requirements: Array<{ type: string; satisfied: boolean }>;
    };
    expect(progress.credits_completed).toBe(4);
    expect(progress.credits_in_progress).toBe(4);
    expect(progress.gpa).toBe(4.0);
    expect(progress.requirements.find((requirement) => requirement.type === 'gpa')?.satisfied).toBe(true);
    const { sqlOne } = await import('../../src/server/degree/repo');
    const program = await sqlOne<{ source: string }>(
      `SELECT source FROM degree_programs WHERE id = '${result.program_id}'`,
    );
    expect(program?.source).toBe('import');
  });

  it('confirm rolls everything back on an invalid requirement reference', async () => {
    const bad = JSON.parse(JSON.stringify(draftOk)) as typeof draftOk;
    bad.requirements.push({ type: 'course', course_code: 'BIO 999', group_name: 'Broken' });
    const { sqlAll } = await import('../../src/server/degree/repo');
    const before = {
      programs: (await sqlAll('SELECT id FROM degree_programs')).length,
      courses: (await sqlAll('SELECT id FROM courses')).length,
      requirements: (await sqlAll('SELECT id FROM requirements')).length,
      completed: (await sqlAll('SELECT id FROM completed_courses')).length,
    };
    await expect(call('confirm_degree_import', { draft: bad })).rejects.toMatchObject({ code: 'bad_request' });
    expect((await sqlAll('SELECT id FROM degree_programs')).length).toBe(before.programs);
    expect((await sqlAll('SELECT id FROM courses')).length).toBe(before.courses);
    expect((await sqlAll('SELECT id FROM requirements')).length).toBe(before.requirements);
    expect((await sqlAll('SELECT id FROM completed_courses')).length).toBe(before.completed);
  });

  it('second fixture parses through schema for milestone and transfer', async () => {
    const { DegreeImportDraftSchema } = await import('../../src/lib/schemas/degree');
    const draft2 = {
      program: {
        name: 'BBA',
        institution: 'Riverton College',
        catalog_year: '2023',
        total_credits_required: 124,
        gpa_requirement: 2.5,
      },
      courses: [
        { code: 'ECON 101', title: 'Microeconomics', credits: 3 },
        { code: 'HIST 220', title: 'World History', credits: 3 },
      ],
      requirements: [
        {
          type: 'credit_bucket',
          credits_required: 3,
          bucket_rule: { course_codes: ['HIST 220', 'INTL 310', 'SPAN 201'] },
          group_name: 'Global Perspective',
        },
        {
          type: 'milestone',
          group_name: 'Senior requirement',
          description: 'Capstone proposal approved',
        },
      ],
      completed_courses: [
        {
          course_code: 'ECON 101',
          term: 'Fall 2022',
          year: 2022,
          grade: 'T',
          credits: 3,
          status: 'transfer',
        },
      ],
    };
    expect(DegreeImportDraftSchema.safeParse(draft2).success).toBe(true);
    const result = await call('confirm_degree_import', { draft: draft2 }) as {
      warnings: string[];
      program_id: string;
    };
    expect(result.warnings).toEqual([]);
    const progress = await call('get_degree_progress', { program_id: result.program_id }) as {
      credits_completed: number;
      requirements: Array<{ untracked: boolean }>;
    };
    expect(progress.credits_completed).toBe(3);
    expect(progress.requirements.some((requirement) => requirement.untracked)).toBe(true);
  });
});

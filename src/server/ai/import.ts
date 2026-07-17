import type OpenAI from 'openai';
import { DegreeImportDraftSchema, normalizeCourseCode, subjectOfCode, type DegreeImportDraft } from '../../lib/schemas/degree';
import { getAiClient } from './client';
import { ToolError } from '../tools/errors';
import { insertRow, newId, nowIso, withTransaction } from '../degree/repo';

export const DEGREE_IMPORT_SYSTEM_PROMPT = [
  'You are Redi’s degree-audit parser. Convert college degree-audit or catalog text into strict JSON.',
  'Return ONLY a JSON object with this exact shape (no markdown fences, no commentary):',
  '{',
  '  "program": { "name": string, "institution": string, "catalog_year": string|null, "total_credits_required": number, "gpa_requirement": number|null },',
  '  "requirements": [{ "type": "course"|"credit_bucket"|"gpa"|"milestone", "course_code": string|null, "credits_required": number|null, "min_grade": string|null,',
  '      "bucket_rule": { "subjects": string[]|null, "number_ranges": [{ "min": number, "max": number }]|null, "course_codes": string[]|null }|null,',
  '      "group_name": string, "description": string|null, "sort_order": number|null }],',
  '  "courses": [{ "code": string, "title": string, "credits": number, "description": string|null, "prerequisites": string[]|null, "typical_terms": string[]|null }],',
  '  "completed_courses": [{ "course_code": string, "term": string, "year": number, "grade": string|null, "credits": number, "status": "completed"|"in_progress"|"transfer" }],',
  '  "confidence_flags": [{ "path": string, "message": string }]',
  '}',
  'Rules:',
  '- Normalize course codes to "SUBJ 123" form (uppercase subject, one space).',
  '- Every course referenced by a requirement or a completed course MUST also appear in "courses" with its best-known title and credits.',
  '- "N credits of X electives" becomes a credit_bucket requirement: subjects for subject lists, number_ranges for course-number ranges, course_codes for explicit lists.',
  '- A minimum-GPA rule becomes one requirement of type "gpa"; also set program.gpa_requirement when stated.',
  '- Non-course obligations (capstone proposal, internship sign-off) become "milestone" requirements.',
  '- Include completed and in-progress courses when the audit lists them; transfer credit uses status "transfer" and grade "T".',
  '- Put anything ambiguous into confidence_flags with a JSON path and a plain-language message.',
  '- Never invent courses, codes, or credits that are not present in the text.',
].join('\n');

export type ImportResult = { ok: true; draft: DegreeImportDraft } | { ok: false; error: string };

interface PdfTextItem { str?: string }
interface PdfPageLike { getTextContent(): Promise<{ items: PdfTextItem[] }> }
interface PdfDocLike { numPages: number; getPage(n: number): Promise<PdfPageLike> }

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const { getDocument } = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (src: { data: Uint8Array; isEvalSupported: boolean }) => { promise: Promise<PdfDocLike> };
  };
  const doc = await getDocument({ data, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str ?? '').join(' '));
  }
  return pages.join('\n');
}

export async function extractAuditText(input: { text?: string; file_base64?: string; filename?: string }): Promise<string> {
  if (input.text?.trim()) return input.text;
  if (!input.file_base64) throw new ToolError('bad_request', 'provide text or file_base64');
  const data = Buffer.from(input.file_base64, 'base64');
  const isPdf = input.filename?.toLowerCase().endsWith('.pdf') || data.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdf) return extractPdfText(new Uint8Array(data));
  return data.toString('utf8');
}

const MAX_AUDIT_CHARS = 12_000;

export async function runDegreeImport(auditText: string): Promise<ImportResult> {
  const { client, model, effort } = await getAiClient();
  const base: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: DEGREE_IMPORT_SYSTEM_PROMPT },
    { role: 'user', content: `Degree audit text (truncated to ${MAX_AUDIT_CHARS} characters):\n\n${auditText.slice(0, MAX_AUDIT_CHARS)}` },
  ];
  let lastErrors = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = [...base];
    if (attempt === 1) {
      messages.push({ role: 'user', content: `The previous JSON failed validation:\n${lastErrors}\nReturn corrected JSON only.` });
    }
    const params: OpenAI.ChatCompletionCreateParams = {
      model,
      messages,
      response_format: { type: 'json_object' },
      reasoning_effort: effort,
    };
    const res = await client.chat.completions.create(params, { timeout: 60_000, maxRetries: 1 });
    const content = res.choices[0]?.message?.content ?? '';
    try {
      const parsed = DegreeImportDraftSchema.safeParse(JSON.parse(content));
      if (parsed.success) return { ok: true, draft: parsed.data };
      lastErrors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
    } catch {
      lastErrors = 'response was not valid JSON';
    }
  }
  return {
    ok: false,
    error: `Redi couldn't parse that audit after 2 attempts (${lastErrors}). You can still build the program manually.`,
  };
}

export interface ConfirmResult {
  program_id: string;
  courses_created: number;
  requirements_created: number;
  completed_created: number;
  warnings: string[];
}

export async function confirmDegreeImport(draft: DegreeImportDraft): Promise<ConfirmResult> {
  const warnings: string[] = [];
  return withTransaction(async () => {
    const now = nowIso();
    const programId = newId();
    await insertRow('degree_programs', {
      id: programId, name: draft.program.name, institution: draft.program.institution,
      catalog_year: draft.program.catalog_year ?? null,
      total_credits_required: draft.program.total_credits_required,
      gpa_requirement: draft.program.gpa_requirement ?? null,
      status: 'active', source: 'import', created_at: now, updated_at: now,
    });
    const courseIds = new Map<string, string>();
    for (const course of draft.courses) {
      const code = normalizeCourseCode(course.code);
      if (courseIds.has(code)) {
        warnings.push(`duplicate course ${code} in draft; kept the first`);
        continue;
      }
      const id = newId();
      courseIds.set(code, id);
      await insertRow('courses', {
        id, program_id: programId, code, title: course.title, credits: course.credits,
        description: course.description ?? null,
        prerequisites: JSON.stringify((course.prerequisites ?? []).map(normalizeCourseCode)),
        typical_terms: JSON.stringify(course.typical_terms ?? []),
        subject: subjectOfCode(code),
      });
    }
    let autoSort = 0;
    for (const requirement of draft.requirements) {
      let courseId: string | null = null;
      if (requirement.type === 'course') {
        courseId = requirement.course_code
          ? (courseIds.get(normalizeCourseCode(requirement.course_code)) ?? null)
          : null;
        if (!courseId) {
          throw new ToolError(
            'bad_request',
            `course requirement "${requirement.group_name}" references unknown course ${requirement.course_code ?? '(none)'}`,
          );
        }
      }
      await insertRow('requirements', {
        id: newId(), program_id: programId, type: requirement.type, course_id: courseId,
        credits_required: requirement.credits_required ?? null, min_grade: requirement.min_grade ?? null,
        bucket_rule: requirement.bucket_rule ? JSON.stringify(requirement.bucket_rule) : null,
        group_name: requirement.group_name, description: requirement.description ?? '',
        sort_order: requirement.sort_order ?? ++autoSort,
      });
    }
    const seenCompleted = new Set<string>();
    let completedCreated = 0;
    for (const completed of draft.completed_courses) {
      const courseId = courseIds.get(normalizeCourseCode(completed.course_code));
      if (!courseId) {
        warnings.push(`completed course ${completed.course_code} is not in the draft's course list; skipped`);
        continue;
      }
      const key = `${courseId}|${completed.term}|${completed.year}`;
      if (seenCompleted.has(key)) {
        warnings.push(`duplicate completed ${completed.course_code} (${completed.term} ${completed.year}); kept the first`);
        continue;
      }
      seenCompleted.add(key);
      await insertRow('completed_courses', {
        id: newId(), program_id: programId, course_id: courseId, term: completed.term, year: completed.year,
        grade: completed.grade ? completed.grade.toUpperCase() : null, credits: completed.credits,
        status: completed.status, source: 'import', created_at: now,
      });
      completedCreated++;
    }
    return {
      program_id: programId,
      courses_created: courseIds.size,
      requirements_created: draft.requirements.length,
      completed_created: completedCreated,
      warnings,
    };
  });
}

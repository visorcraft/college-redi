import { z, type ZodType } from 'zod';
import type { Tool } from './registry';
import { ConfirmRequiredError, ToolError } from './errors';
import {
  AddCourseParams, AddRequirementParams, CreateProgramParams, DeleteCourseParams,
  DeleteProgramParams, DeleteRequirementParams, GetProgramParams, ListCoursesParams,
  GetDegreeProgressParams, GetRegistrationStatusParams, ListProgramsParams,
  ListRequirementsParams, MarkCompletedParams, PlanCourseParams,
  RemovePlannedParams, UnmarkCompletedParams, UpdateCourseParams, UpdatePlannedParams,
  UpdateProgramParams, UpdateRequirementParams, normalizeCourseCode, subjectOfCode,
  ConfirmDegreeImportParams, ImportDegreeAuditParams,
  type BucketRule,
} from '../../lib/schemas/degree';
import {
  COMPLETED_COLS, COURSE_COLS, PROGRAM_COLS, REQUIREMENT_COLS, assertCourseCodeFree,
  assertPlannedFree, courseRefCounts, deleteWhere, getCompletedOrThrow, getCourseOrThrow,
  getCourseForProgramOrThrow, getPlannedOrThrow, getProgramOrThrow, getRequirementOrThrow, getTermOrThrow, insertRow,
  lit, newId, nowIso, sqlAll, sqlOne, toCourse, toRequirement, updateRow, withTransaction,
  type CompletedRow, type ProgramRow,
} from '../degree/repo';
import { computeDegreeProgress, getRegistrationStatus } from '../degree/progress';
import { confirmDegreeImport, extractAuditText, runDegreeImport } from '../ai/import';

export function def<P, R>(t: {
  name: string;
  description: string;
  sideEffect: Tool<P, R>['sideEffect'];
  paramsSchema: ZodType<P>;
  handler: (params: P) => Promise<R>;
}): Tool<P, R> {
  return {
    ...t,
    jsonSchema: z.toJSONSchema(t.paramsSchema) as Tool<P, R>['jsonSchema'],
    handler: async (_ctx, raw) => t.handler(t.paramsSchema.parse(raw)),
  };
}

function validateRequirementShape(p: { type: string; course_id?: string | null; credits_required?: number | null; bucket_rule?: BucketRule | null }): void {
  if (p.type === 'course' && !p.course_id) throw new ToolError('bad_request', 'course requirement needs course_id');
  if (p.type === 'credit_bucket') {
    if (!p.credits_required) throw new ToolError('bad_request', 'credit_bucket requirement needs credits_required');
    if (!p.bucket_rule) throw new ToolError('bad_request', 'credit_bucket requirement needs bucket_rule');
  }
}

const defined = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;

const list_programs = def({
  name: 'list_programs',
  description: 'List degree programs, optionally filtered by status (active|completed|abandoned).',
  sideEffect: 'read',
  paramsSchema: ListProgramsParams,
  handler: (p) => sqlAll<ProgramRow>(`SELECT ${PROGRAM_COLS} FROM degree_programs${p.status ? ` WHERE status = ${lit(p.status)}` : ''} ORDER BY created_at`),
});

const get_program = def({
  name: 'get_program',
  description: 'Get one degree program by id.',
  sideEffect: 'read',
  paramsSchema: GetProgramParams,
  handler: (p) => getProgramOrThrow(p.id),
});

const create_program = def({
  name: 'create_program',
  description: 'Create a degree program (source=manual).',
  sideEffect: 'write',
  paramsSchema: CreateProgramParams,
  handler: async (p) => {
    const id = newId();
    const now = nowIso();
    await insertRow('degree_programs', {
      id, name: p.name, institution: p.institution, catalog_year: p.catalog_year ?? '',
      total_credits_required: p.total_credits_required, gpa_requirement: p.gpa_requirement ?? null,
      status: p.status ?? 'active', source: 'manual', created_at: now, updated_at: now,
    });
    return getProgramOrThrow(id);
  },
});

const update_program = def({
  name: 'update_program',
  description: 'Patch a degree program.',
  sideEffect: 'write',
  paramsSchema: UpdateProgramParams,
  handler: async (p) => {
    await getProgramOrThrow(p.id);
    const { id, catalog_year, ...rest } = p;
    await updateRow('degree_programs', id, {
      ...defined(rest),
      ...(catalog_year !== undefined ? { catalog_year: catalog_year ?? '' } : {}),
      updated_at: nowIso(),
    });
    return getProgramOrThrow(id);
  },
});

const delete_program = def({
  name: 'delete_program',
  description: 'Delete a degree program and all of its requirements, courses, completed and planned courses. Requires confirm: true.',
  sideEffect: 'destructive',
  paramsSchema: DeleteProgramParams,
  handler: async (p) => {
    if (p.confirm !== true) throw new ConfirmRequiredError('delete_program');
    await getProgramOrThrow(p.id);
    await withTransaction(async () => {
      await deleteWhere('planned_courses', `program_id = ${lit(p.id)}`);
      await deleteWhere('completed_courses', `program_id = ${lit(p.id)}`);
      await deleteWhere('requirements', `program_id = ${lit(p.id)}`);
      await deleteWhere('courses', `program_id = ${lit(p.id)}`);
      await deleteWhere('degree_programs', `id = ${lit(p.id)}`);
    });
    return { deleted: true, id: p.id };
  },
});

const list_requirements = def({
  name: 'list_requirements',
  description: 'List requirements of a program, ordered by sort_order.',
  sideEffect: 'read',
  paramsSchema: ListRequirementsParams,
  handler: async (p) => {
    const rows = await sqlAll(`SELECT ${REQUIREMENT_COLS} FROM requirements WHERE program_id = ${lit(p.program_id)} ORDER BY sort_order, group_name`);
    return rows.map(toRequirement);
  },
});

const add_requirement = def({
  name: 'add_requirement',
  description: 'Add a requirement (course | credit_bucket | gpa | milestone) to a program.',
  sideEffect: 'write',
  paramsSchema: AddRequirementParams,
  handler: async (p) => {
    await getProgramOrThrow(p.program_id);
    validateRequirementShape(p);
    if (p.course_id) await getCourseForProgramOrThrow(p.program_id, p.course_id);
    const sort_order = p.sort_order
      ?? (await sqlOne<{ next_sort: number }>(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort FROM requirements WHERE program_id = ${lit(p.program_id)}`))!.next_sort;
    const id = newId();
    await insertRow('requirements', {
      id, program_id: p.program_id, type: p.type, course_id: p.course_id ?? null,
      credits_required: p.credits_required ?? null, min_grade: p.min_grade ?? null,
      bucket_rule: p.bucket_rule ? JSON.stringify(p.bucket_rule) : null,
      group_name: p.group_name, description: p.description ?? '', sort_order,
    });
    return getRequirementOrThrow(id);
  },
});

const update_requirement = def({
  name: 'update_requirement',
  description: 'Patch a requirement; type-shape rules are re-validated on the merged row.',
  sideEffect: 'write',
  paramsSchema: UpdateRequirementParams,
  handler: async (p) => {
    const existing = await getRequirementOrThrow(p.id);
    const { id, bucket_rule, ...rest } = p;
    const merged = { ...existing, ...defined(rest), ...(bucket_rule !== undefined ? { bucket_rule } : {}) };
    validateRequirementShape(merged);
    if (merged.course_id) {
      await getCourseForProgramOrThrow(existing.program_id, merged.course_id);
    }
    await updateRow('requirements', id, {
      ...defined(rest),
      ...(bucket_rule !== undefined ? { bucket_rule: bucket_rule ? JSON.stringify(bucket_rule) : null } : {}),
    });
    return getRequirementOrThrow(id);
  },
});

const delete_requirement = def({
  name: 'delete_requirement',
  description: 'Delete a requirement. Requires confirm: true.',
  sideEffect: 'destructive',
  paramsSchema: DeleteRequirementParams,
  handler: async (p) => {
    if (p.confirm !== true) throw new ConfirmRequiredError('delete_requirement');
    await getRequirementOrThrow(p.id);
    await deleteWhere('requirements', `id = ${lit(p.id)}`);
    return { deleted: true, id: p.id };
  },
});

const list_courses = def({
  name: 'list_courses',
  description: 'List courses of a program, optionally filtered by subject.',
  sideEffect: 'read',
  paramsSchema: ListCoursesParams,
  handler: async (p) => {
    const rows = await sqlAll(`SELECT ${COURSE_COLS} FROM courses WHERE program_id = ${lit(p.program_id)}${p.subject ? ` AND subject = ${lit(p.subject.toUpperCase())}` : ''} ORDER BY code`);
    return rows.map(toCourse);
  },
});

const add_course = def({
  name: 'add_course',
  description: 'Add a course to a program catalog. Code is normalized ("cs101" -> "CS 101"); subject is derived from the code.',
  sideEffect: 'write',
  paramsSchema: AddCourseParams,
  handler: async (p) => {
    await getProgramOrThrow(p.program_id);
    const code = normalizeCourseCode(p.code);
    await assertCourseCodeFree(p.program_id, code);
    const id = newId();
    await insertRow('courses', {
      id, program_id: p.program_id, code, title: p.title, credits: p.credits,
      description: p.description ?? null,
      prerequisites: JSON.stringify((p.prerequisites ?? []).map(normalizeCourseCode)),
      typical_terms: JSON.stringify(p.typical_terms ?? []),
      subject: subjectOfCode(code),
    });
    return getCourseOrThrow(id);
  },
});

const update_course = def({
  name: 'update_course',
  description: 'Patch a course; a code change re-derives subject and re-checks uniqueness.',
  sideEffect: 'write',
  paramsSchema: UpdateCourseParams,
  handler: async (p) => {
    const existing = await getCourseOrThrow(p.id);
    const { id, code, prerequisites, typical_terms, ...rest } = p;
    const patch: Record<string, string | number | null> = { ...defined(rest) };
    if (code) {
      const normalized = normalizeCourseCode(code);
      await assertCourseCodeFree(existing.program_id, normalized, id);
      patch.code = normalized;
      patch.subject = subjectOfCode(normalized);
    }
    if (prerequisites) patch.prerequisites = JSON.stringify(prerequisites.map(normalizeCourseCode));
    if (typical_terms) patch.typical_terms = JSON.stringify(typical_terms);
    await updateRow('courses', id, patch);
    return getCourseOrThrow(id);
  },
});

const delete_course = def({
  name: 'delete_course',
  description: 'Delete a course. Blocked while requirements, completed courses, or planned courses reference it. Requires confirm: true.',
  sideEffect: 'destructive',
  paramsSchema: DeleteCourseParams,
  handler: async (p) => {
    if (p.confirm !== true) throw new ConfirmRequiredError('delete_course');
    const course = await getCourseOrThrow(p.id);
    const refs = await courseRefCounts(p.id);
    const total = refs.requirements + refs.completed + refs.planned;
    if (total > 0) {
      throw new ToolError('conflict', `course ${course.code} is still referenced (${refs.requirements} requirements, ${refs.completed} completed, ${refs.planned} planned)`, 409);
    }
    await deleteWhere('courses', `id = ${lit(p.id)}`);
    return { deleted: true, id: p.id };
  },
});

const mark_course_completed = def({
  name: 'mark_course_completed',
  description: 'Record a completed/in-progress/transfer course with term, year, and grade. Upserts on (program_id, course_id, term, year).',
  sideEffect: 'write',
  paramsSchema: MarkCompletedParams,
  handler: async (p) => {
    await getProgramOrThrow(p.program_id);
    const course = await getCourseForProgramOrThrow(p.program_id, p.course_id);
    const existing = await sqlOne<CompletedRow>(
      `SELECT ${COMPLETED_COLS} FROM completed_courses WHERE program_id = ${lit(p.program_id)} AND course_id = ${lit(p.course_id)} AND term = ${lit(p.term)} AND year = ${p.year}`);
    const values = {
      grade: p.grade ? p.grade.toUpperCase() : null,
      credits: p.credits ?? course.credits,
      status: p.status ?? 'completed',
      source: p.source ?? 'manual',
    };
    if (existing) {
      await updateRow('completed_courses', existing.id, values);
      return getCompletedOrThrow(existing.id);
    }
    const id = newId();
    await insertRow('completed_courses', {
      id, program_id: p.program_id, course_id: p.course_id, term: p.term, year: p.year,
      ...values, created_at: nowIso(),
    });
    return getCompletedOrThrow(id);
  },
});

const unmark_course_completed = def({
  name: 'unmark_course_completed',
  description: 'Remove a completed-course record by id.',
  sideEffect: 'write',
  paramsSchema: UnmarkCompletedParams,
  handler: async (p) => {
    await getCompletedOrThrow(p.id);
    await deleteWhere('completed_courses', `id = ${lit(p.id)}`);
    return { deleted: true, id: p.id };
  },
});

const plan_course = def({
  name: 'plan_course',
  description: 'Plan a course for a term (status starts as "planned").',
  sideEffect: 'write',
  paramsSchema: PlanCourseParams,
  handler: async (p) => {
    await getProgramOrThrow(p.program_id);
    await getCourseForProgramOrThrow(p.program_id, p.course_id);
    await getTermOrThrow(p.term_id);
    await assertPlannedFree(p.program_id, p.course_id, p.term_id);
    const id = newId();
    const now = nowIso();
    await insertRow('planned_courses', {
      id, program_id: p.program_id, course_id: p.course_id, term_id: p.term_id,
      status: 'planned', section: p.section ?? null, notes: p.notes ?? null,
      created_at: now, updated_at: now,
    });
    return getPlannedOrThrow(id);
  },
});

const update_planned_course = def({
  name: 'update_planned_course',
  description: 'Update a planned course: registration status (planned|registered|waitlisted|dropped|completed), section, notes.',
  sideEffect: 'write',
  paramsSchema: UpdatePlannedParams,
  handler: async (p) => {
    await getPlannedOrThrow(p.id);
    const { id, ...rest } = p;
    await updateRow('planned_courses', id, { ...defined(rest), updated_at: nowIso() });
    return getPlannedOrThrow(id);
  },
});

const remove_planned_course = def({
  name: 'remove_planned_course',
  description: 'Remove a course from a term plan. Requires confirm: true.',
  sideEffect: 'destructive',
  paramsSchema: RemovePlannedParams,
  handler: async (p) => {
    if (p.confirm !== true) throw new ConfirmRequiredError('remove_planned_course');
    await getPlannedOrThrow(p.id);
    await deleteWhere('planned_courses', `id = ${lit(p.id)}`);
    return { deleted: true, id: p.id };
  },
});

const get_degree_progress = def({
  name: 'get_degree_progress',
  description: 'Per-requirement and overall degree progress: credits, GPA, projected graduation term, and at-risk flags. Defaults to the active program.',
  sideEffect: 'read',
  paramsSchema: GetDegreeProgressParams,
  handler: (p) => computeDegreeProgress(p.program_id),
});

const get_registration_status = def({
  name: 'get_registration_status',
  description: 'For a term (default: nearest upcoming): registration window state plus each planned course’s registration status.',
  sideEffect: 'read',
  paramsSchema: GetRegistrationStatusParams,
  handler: (p) => getRegistrationStatus(p.term_id),
});

const import_degree_audit = def({
  name: 'import_degree_audit',
  description: 'Parse pasted text or an uploaded PDF/TXT degree audit via AI into a structured draft. Persists nothing. Review the draft, then call confirm_degree_import.',
  sideEffect: 'write',
  paramsSchema: ImportDegreeAuditParams,
  handler: async (p) => runDegreeImport(await extractAuditText(p)),
});

const confirm_degree_import = def({
  name: 'confirm_degree_import',
  description: 'Persist a reviewed degree-import draft transactionally: program, courses, requirements, and completed courses, tagged source=import.',
  sideEffect: 'write',
  paramsSchema: ConfirmDegreeImportParams,
  handler: (p) => confirmDegreeImport(p.draft),
});

export const degreeTools = [
  list_programs, get_program, create_program, update_program, delete_program,
  list_requirements, add_requirement, update_requirement, delete_requirement,
  list_courses, add_course, update_course, delete_course,
  mark_course_completed, unmark_course_completed,
  plan_course, update_planned_course, remove_planned_course,
  get_degree_progress, get_registration_status,
  import_degree_audit, confirm_degree_import,
] as Tool[];

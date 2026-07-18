import { lit, sqlExec, sqlRows, withSqlTransaction } from '../db/sql';
import { ConflictError, NotFoundError } from '../tools/errors';
import type { BucketRule } from '../../lib/schemas/degree';

export function newId(): string { return crypto.randomUUID(); }
export function nowIso(): string { return new Date().toISOString(); }

type SqlValue = string | number | bigint | boolean | null | undefined;
export { lit, sqlExec };

export async function sqlAll<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return sqlRows<T>(sql);
}
export async function sqlOne<T = Record<string, unknown>>(sql: string): Promise<T | null> {
  return (await sqlAll<T>(sql))[0] ?? null;
}
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return withSqlTransaction(fn);
}

export async function insertRow(table: string, rec: Record<string, SqlValue>): Promise<void> {
  const cols = Object.keys(rec);
  await sqlExec(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => lit(rec[c])).join(', ')})`);
}
export async function updateRow(table: string, id: string, patch: Record<string, SqlValue>): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  await sqlExec(`UPDATE ${table} SET ${entries.map(([k, v]) => `${k} = ${lit(v)}`).join(', ')} WHERE id = ${lit(id)}`);
}
export async function deleteWhere(table: string, where: string): Promise<void> {
  await sqlExec(`DELETE FROM ${table} WHERE ${where}`);
}
async function countWhere(table: string, where: string): Promise<number> {
  const row = await sqlOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  return row?.n ?? 0;
}

export interface ProgramRow { id: string; name: string; institution: string; catalog_year: string; total_credits_required: number; gpa_requirement: number | null; status: string; source: string; created_at: string; updated_at: string }
export interface RequirementRow { id: string; program_id: string; type: string; course_id: string | null; credits_required: number | null; min_grade: string | null; bucket_rule: BucketRule | null; group_name: string; description: string; sort_order: number }
export interface CourseRow { id: string; program_id: string; code: string; title: string; credits: number; description: string | null; prerequisites: string[]; typical_terms: string[]; subject: string }
export interface CompletedRow { id: string; program_id: string; course_id: string; term: string; year: number; grade: string | null; credits: number; status: string; source: string; created_at: string }
export interface TermRow { id: string; name: string; classes_start: string; classes_end: string; registration_opens_at: string | null; registration_closes_at: string | null; add_drop_deadline: string | null; tuition_due: string | null; notes: string | null }
export interface PlannedRow { id: string; program_id: string; course_id: string; term_id: string; status: string; section: string | null; notes: string | null; created_at: string; updated_at: string }

export const PROGRAM_COLS = 'id, name, institution, catalog_year, total_credits_required, gpa_requirement, status, source, created_at, updated_at';
export const REQUIREMENT_COLS = 'id, program_id, type, course_id, credits_required, min_grade, bucket_rule, group_name, description, sort_order';
export const COURSE_COLS = 'id, program_id, code, title, credits, description, prerequisites, typical_terms, subject';
export const COMPLETED_COLS = 'id, program_id, course_id, term, year, grade, credits, status, source, created_at';
export const TERM_COLS = 'id, name, classes_start, classes_end, registration_opens_at, registration_closes_at, add_drop_deadline, tuition_due, notes';
export const PLANNED_COLS = 'id, program_id, course_id, term_id, status, section, notes, created_at, updated_at';

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
export function toRequirement(r: Record<string, unknown>): RequirementRow {
  return { ...(r as unknown as RequirementRow), bucket_rule: parseJson<BucketRule | null>(r.bucket_rule, null) };
}
export function toCourse(r: Record<string, unknown>): CourseRow {
  return {
    ...(r as unknown as CourseRow),
    prerequisites: parseJson<string[]>(r.prerequisites, []),
    typical_terms: parseJson<string[]>(r.typical_terms, []),
  };
}

export async function getProgramOrThrow(id: string): Promise<ProgramRow> {
  const row = await sqlOne<ProgramRow>(`SELECT ${PROGRAM_COLS} FROM degree_programs WHERE id = ${lit(id)}`);
  if (!row) throw new NotFoundError(`degree program ${id} not found`);
  return row;
}
export async function getRequirementOrThrow(id: string): Promise<RequirementRow> {
  const row = await sqlOne(`SELECT ${REQUIREMENT_COLS} FROM requirements WHERE id = ${lit(id)}`);
  if (!row) throw new NotFoundError(`requirement ${id} not found`);
  return toRequirement(row);
}
export async function getCourseOrThrow(id: string): Promise<CourseRow> {
  const row = await sqlOne(`SELECT ${COURSE_COLS} FROM courses WHERE id = ${lit(id)}`);
  if (!row) throw new NotFoundError(`course ${id} not found`);
  return toCourse(row);
}
export async function getCourseForProgramOrThrow(programId: string, courseId: string): Promise<CourseRow> {
  const course = await getCourseOrThrow(courseId);
  if (course.program_id !== programId) {
    throw new ConflictError(`course ${course.code} does not belong to program ${programId}`);
  }
  return course;
}
export async function getCompletedOrThrow(id: string): Promise<CompletedRow> {
  const row = await sqlOne<CompletedRow>(`SELECT ${COMPLETED_COLS} FROM completed_courses WHERE id = ${lit(id)}`);
  if (!row) throw new NotFoundError(`completed course ${id} not found`);
  return row;
}
export async function getTermOrThrow(id: string): Promise<TermRow> {
  const row = await sqlOne<TermRow>(`SELECT ${TERM_COLS} FROM terms WHERE id = ${lit(id)}`);
  if (!row) throw new NotFoundError(`term ${id} not found`);
  return row;
}
export async function getPlannedOrThrow(id: string): Promise<PlannedRow> {
  const row = await sqlOne<PlannedRow>(`SELECT ${PLANNED_COLS} FROM planned_courses WHERE id = ${lit(id)}`);
  if (!row) throw new NotFoundError(`planned course ${id} not found`);
  return row;
}
export async function findCourseByCode(programId: string, code: string): Promise<CourseRow | null> {
  const row = await sqlOne(`SELECT ${COURSE_COLS} FROM courses WHERE program_id = ${lit(programId)} AND code = ${lit(code)}`);
  return row ? toCourse(row) : null;
}
export async function assertCourseCodeFree(programId: string, code: string, excludeId?: string): Promise<void> {
  const clash = await sqlOne(`SELECT id FROM courses WHERE program_id = ${lit(programId)} AND code = ${lit(code)}${excludeId ? ` AND id <> ${lit(excludeId)}` : ''}`);
  if (clash) throw new ConflictError(`course ${code} already exists in this program`);
}
export async function assertPlannedFree(programId: string, courseId: string, termId: string): Promise<void> {
  const clash = await sqlOne(`SELECT id FROM planned_courses WHERE program_id = ${lit(programId)} AND course_id = ${lit(courseId)} AND term_id = ${lit(termId)}`);
  if (clash) throw new ConflictError('that course is already planned for that term');
}
export async function courseRefCounts(courseId: string): Promise<{ requirements: number; completed: number; planned: number }> {
  return {
    requirements: await countWhere('requirements', `course_id = ${lit(courseId)}`),
    completed: await countWhere('completed_courses', `course_id = ${lit(courseId)}`),
    planned: await countWhere('planned_courses', `course_id = ${lit(courseId)}`),
  };
}

export interface PlannedJoined extends PlannedRow { course_code: string; course_title: string; credits: number; term_name: string; classes_start: string }
export async function listPlannedCourses(programId: string): Promise<PlannedJoined[]> {
  return sqlAll<PlannedJoined>(
    `SELECT p.${PLANNED_COLS.split(', ').join(', p.')}, c.code AS course_code, c.title AS course_title, c.credits AS credits, t.name AS term_name, t.classes_start AS classes_start
     FROM planned_courses p
     JOIN courses c ON c.id = p.course_id
     JOIN terms t ON t.id = p.term_id
     WHERE p.program_id = ${lit(programId)}
     ORDER BY t.classes_start, c.code`);
}
export interface CompletedJoined extends CompletedRow { course_code: string; course_title: string }
export async function listCompletedCourses(programId: string): Promise<CompletedJoined[]> {
  return sqlAll<CompletedJoined>(
    `SELECT cc.${COMPLETED_COLS.split(', ').join(', cc.')}, c.code AS course_code, c.title AS course_title
     FROM completed_courses cc
     JOIN courses c ON c.id = cc.course_id
     WHERE cc.program_id = ${lit(programId)}
     ORDER BY cc.year, cc.term, c.code`);
}

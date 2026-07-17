import {
  courseMatchesBucket, earnsCredits, gradeMeets, gradePoints, normalizeCourseCode,
  type BucketRule,
} from '../../lib/schemas/degree';
import { NotFoundError } from '../tools/errors';
import {
  COMPLETED_COLS, COURSE_COLS, PLANNED_COLS, PROGRAM_COLS, REQUIREMENT_COLS, TERM_COLS,
  lit, sqlAll, sqlOne, toCourse, toRequirement,
  type CompletedRow, type CourseRow, type PlannedRow, type ProgramRow, type RequirementRow, type TermRow,
} from './repo';

export interface PlannedWithTerm extends PlannedRow { term_name: string; classes_start: string }
export interface ProgressInput {
  program: ProgramRow;
  requirements: RequirementRow[];
  courses: CourseRow[];
  completed: CompletedRow[];
  planned: PlannedRow[];
  terms: TermRow[];
}
export interface SatisfiedByEntry { course_code: string; term: string; year: number; grade: string | null; credits: number; status: string }
export interface RequirementProgress {
  requirement_id: string; type: string; group_name: string; description: string;
  credits_required: number | null; credits_satisfied: number; satisfied: boolean;
  in_progress: boolean; untracked: boolean; satisfied_by: SatisfiedByEntry[];
}
export interface RiskFlag {
  type: 'unmet_prerequisite' | 'uncovered_requirement' | 'gpa_below_requirement';
  message: string;
  requirement_id?: string;
  course_code?: string;
  term?: string;
}
export interface DegreeProgress {
  program_id: string; program_name: string;
  total_credits_required: number; credits_completed: number; credits_in_progress: number; credits_planned: number;
  percent_complete: number; gpa: number | null; gpa_requirement: number | null;
  requirements: RequirementProgress[];
  requirements_met: boolean; projected_graduation_term: string | null;
  status: 'on_track' | 'at_risk'; risk_flags: RiskFlag[];
}
export interface RegistrationWindow {
  state: 'not_scheduled' | 'upcoming' | 'open' | 'closed';
  opens_at: string | null; closes_at: string | null;
  days_until_open: number | null; days_until_close: number | null;
}
export interface RegistrationStatusResult {
  term: TermRow | null;
  window: RegistrationWindow;
  planned_courses: Array<{
    id: string; course_code: string; title: string; credits: number;
    status: string; section: string | null; notes: string | null;
  }>;
  unregistered_count: number;
}

const DAY_MS = 86_400_000;

export function computeWindow(
  term: Partial<Pick<TermRow, 'registration_opens_at' | 'registration_closes_at'>>,
  now: Date,
): RegistrationWindow {
  const opens = term.registration_opens_at ?? null;
  const closes = term.registration_closes_at ?? null;
  const base = { opens_at: opens, closes_at: closes, days_until_open: null, days_until_close: null } as RegistrationWindow;
  if (!opens && !closes) return { ...base, state: 'not_scheduled' };
  const nowIso = now.toISOString();
  if (opens && nowIso < opens) {
    return { ...base, state: 'upcoming', days_until_open: Math.ceil((Date.parse(opens) - now.getTime()) / DAY_MS) };
  }
  if (closes && nowIso > closes) return { ...base, state: 'closed' };
  return {
    ...base,
    state: 'open',
    days_until_close: closes ? Math.max(0, Math.ceil((Date.parse(closes) - now.getTime()) / DAY_MS)) : null,
  };
}

function computeGpa(completed: CompletedRow[]): number | null {
  let points = 0;
  let credits = 0;
  for (const c of completed) {
    if (c.status !== 'completed') continue;
    const p = gradePoints(c.grade);
    if (p === null) continue;
    points += p * c.credits;
    credits += c.credits;
  }
  return credits > 0 ? Math.round((points / credits) * 100) / 100 : null;
}

interface CreditEntry { course_id: string; credits: number }

function coveredByRequirement(r: RequirementRow, entries: CreditEntry[], courseById: Map<string, CourseRow>): boolean {
  if (r.type === 'course') return entries.some((e) => e.course_id === r.course_id);
  if (r.type === 'credit_bucket') {
    const rule = r.bucket_rule as BucketRule | null;
    if (!rule) return false;
    const sum = entries.reduce((s, e) => {
      const course = courseById.get(e.course_id);
      return course && courseMatchesBucket(rule, course) ? s + e.credits : s;
    }, 0);
    return sum >= (r.credits_required ?? 0);
  }
  return true;
}

export function evaluateDegreeProgress(input: ProgressInput): DegreeProgress {
  const { program, requirements, courses, completed, planned, terms } = input;
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const termById = new Map(terms.map((t) => [t.id, t]));
  const plannedStart = (p: PlannedRow) =>
    (p as Partial<PlannedWithTerm>).classes_start ?? termById.get(p.term_id)?.classes_start ?? '';
  const plannedTerm = (p: PlannedRow) =>
    (p as Partial<PlannedWithTerm>).term_name ?? termById.get(p.term_id)?.name ?? '';
  const gpa = computeGpa(completed);
  const earning = completed.filter((c) => c.status !== 'in_progress' && earnsCredits(c.grade));
  const inProgress = completed.filter((c) => c.status === 'in_progress');
  const toEntry = (c: CompletedRow): SatisfiedByEntry => ({
    course_code: courseById.get(c.course_id)?.code ?? '?',
    term: c.term,
    year: c.year,
    grade: c.grade,
    credits: c.credits,
    status: c.status,
  });

  const reqProgress: RequirementProgress[] = requirements.map((r) => {
    const base = {
      requirement_id: r.id,
      type: r.type,
      group_name: r.group_name,
      description: r.description,
      in_progress: false,
      untracked: false,
      satisfied_by: [] as SatisfiedByEntry[],
    };
    if (r.type === 'course') {
      const course = r.course_id ? courseById.get(r.course_id) : undefined;
      const passing = earning.filter((c) => c.course_id === r.course_id && gradeMeets(c.grade, r.min_grade));
      const satisfied = passing.length > 0;
      return {
        ...base,
        credits_required: course?.credits ?? null,
        credits_satisfied: satisfied ? (course?.credits ?? 0) : 0,
        satisfied,
        in_progress: !satisfied && inProgress.some((c) => c.course_id === r.course_id),
        satisfied_by: passing.map(toEntry),
      };
    }
    if (r.type === 'credit_bucket') {
      const rule = r.bucket_rule as BucketRule | null;
      const matched = rule
        ? earning.filter((c) => {
            const course = courseById.get(c.course_id);
            return course !== undefined && courseMatchesBucket(rule, course) && gradeMeets(c.grade, r.min_grade);
          })
        : [];
      const sum = matched.reduce((s, c) => s + c.credits, 0);
      const needed = r.credits_required ?? 0;
      return {
        ...base,
        credits_required: r.credits_required,
        credits_satisfied: sum,
        satisfied: sum >= needed,
        in_progress: sum < needed && rule !== null && inProgress.some((c) => {
          const course = courseById.get(c.course_id);
          return course !== undefined && courseMatchesBucket(rule, course);
        }),
        satisfied_by: matched.map(toEntry),
      };
    }
    if (r.type === 'gpa') {
      const threshold = program.gpa_requirement;
      return {
        ...base,
        credits_required: null,
        credits_satisfied: 0,
        satisfied: threshold === null || (gpa !== null && gpa >= threshold),
      };
    }
    return { ...base, credits_required: null, credits_satisfied: 0, satisfied: false, untracked: true };
  });

  const plannedActive = planned.filter((p) => p.status !== 'dropped');
  const plannedDone = planned.filter((p) => p.status === 'completed');
  const plannedFuture = plannedActive.filter((p) => p.status !== 'completed');
  const toCredit = (courseId: string): CreditEntry => ({
    course_id: courseId,
    credits: courseById.get(courseId)?.credits ?? 0,
  });
  const coverageEntries: CreditEntry[] = [
    ...earning.map((c) => ({ course_id: c.course_id, credits: c.credits })),
    ...inProgress.map((c) => ({ course_id: c.course_id, credits: c.credits })),
    ...plannedActive.map((p) => toCredit(p.course_id)),
  ];
  const risk_flags: RiskFlag[] = [];

  for (const r of requirements) {
    if (r.type !== 'course' && r.type !== 'credit_bucket') continue;
    if (!coveredByRequirement(r, coverageEntries, courseById)) {
      risk_flags.push({
        type: 'uncovered_requirement',
        requirement_id: r.id,
        message: `"${r.group_name}" has no completed, in-progress, or planned course covering it yet`,
      });
    }
  }

  const doneCodes = new Set([
    ...earning.map((c) => courseById.get(c.course_id)?.code),
    ...inProgress.map((c) => courseById.get(c.course_id)?.code),
    ...plannedDone.map((p) => courseById.get(p.course_id)?.code),
  ].filter((x): x is string => Boolean(x)).map(normalizeCourseCode));
  for (const p of plannedFuture) {
    const course = courseById.get(p.course_id);
    if (!course) continue;
    const earlierCodes = new Set(
      plannedActive
        .filter((q) => plannedStart(q) < plannedStart(p))
        .map((q) => courseById.get(q.course_id)?.code)
        .filter((x): x is string => Boolean(x))
        .map(normalizeCourseCode),
    );
    for (const pre of course.prerequisites) {
      const norm = normalizeCourseCode(pre);
      if (!doneCodes.has(norm) && !earlierCodes.has(norm)) {
        risk_flags.push({
          type: 'unmet_prerequisite',
          course_code: course.code,
          term: plannedTerm(p),
          message: `${course.code} in ${plannedTerm(p)} needs ${norm} first (complete it or plan it in an earlier term)`,
        });
      }
    }
  }

  if (gpa !== null && program.gpa_requirement !== null && gpa < program.gpa_requirement) {
    risk_flags.push({
      type: 'gpa_below_requirement',
      message: `GPA ${gpa} is below the ${program.gpa_requirement} program requirement`,
    });
  }

  const baseEntries: CreditEntry[] = [
    ...earning.map((c) => ({ course_id: c.course_id, credits: c.credits })),
    ...inProgress.map((c) => ({ course_id: c.course_id, credits: c.credits })),
    ...plannedDone.map((p) => toCredit(p.course_id)),
  ];
  const coversAll = (entries: CreditEntry[]) =>
    requirements.every((r) => coveredByRequirement(r, entries, courseById));
  const requirements_met = coversAll(baseEntries);
  let projected: string | null = null;
  if (!requirements_met) {
    const termNames = [...new Set(plannedFuture.map(plannedTerm))]
      .map((name) => plannedFuture.find((p) => plannedTerm(p) === name)!)
      .sort((a, b) => plannedStart(a).localeCompare(plannedStart(b)))
      .map(plannedTerm);
    const cumulative = [...baseEntries];
    for (const name of termNames) {
      cumulative.push(...plannedFuture.filter((p) => plannedTerm(p) === name).map((p) => toCredit(p.course_id)));
      if (coversAll(cumulative)) {
        projected = name;
        break;
      }
    }
  }

  const credits_completed = earning.reduce((s, c) => s + c.credits, 0);
  const credits_in_progress = inProgress.reduce((s, c) => s + c.credits, 0);
  const credits_planned = plannedFuture.reduce((s, p) => s + (courseById.get(p.course_id)?.credits ?? 0), 0);
  const percent_complete = program.total_credits_required > 0
    ? Math.min(100, Math.round((credits_completed / program.total_credits_required) * 1000) / 10)
    : 0;

  return {
    program_id: program.id,
    program_name: program.name,
    total_credits_required: program.total_credits_required,
    credits_completed,
    credits_in_progress,
    credits_planned,
    percent_complete,
    gpa,
    gpa_requirement: program.gpa_requirement,
    requirements: reqProgress,
    requirements_met,
    projected_graduation_term: projected,
    status: risk_flags.length ? 'at_risk' : 'on_track',
    risk_flags,
  };
}

export async function loadProgressInput(programId?: string): Promise<ProgressInput> {
  const program = programId
    ? await sqlOne<ProgramRow>(`SELECT ${PROGRAM_COLS} FROM degree_programs WHERE id = ${lit(programId)}`)
    : await sqlOne<ProgramRow>(`SELECT ${PROGRAM_COLS} FROM degree_programs WHERE status = 'active' ORDER BY created_at LIMIT 1`);
  if (!program) {
    throw new NotFoundError(programId ? `degree program ${programId} not found` : 'no active degree program yet — create or import one first');
  }
  const [requirements, courseRows, completed, planned, terms] = await Promise.all([
    sqlAll(`SELECT ${REQUIREMENT_COLS} FROM requirements WHERE program_id = ${lit(program.id)} ORDER BY sort_order, group_name`),
    sqlAll(`SELECT ${COURSE_COLS} FROM courses WHERE program_id = ${lit(program.id)}`),
    sqlAll<CompletedRow>(`SELECT ${COMPLETED_COLS} FROM completed_courses WHERE program_id = ${lit(program.id)}`),
    sqlAll<PlannedWithTerm>(
      `SELECT p.${PLANNED_COLS.split(', ').join(', p.')}, t.name AS term_name, t.classes_start AS classes_start
       FROM planned_courses p JOIN terms t ON t.id = p.term_id WHERE p.program_id = ${lit(program.id)}`),
    sqlAll<TermRow>(`SELECT ${TERM_COLS} FROM terms ORDER BY classes_start`),
  ]);
  return {
    program,
    requirements: requirements.map(toRequirement),
    courses: courseRows.map(toCourse),
    completed,
    planned,
    terms,
  };
}

export async function computeDegreeProgress(programId?: string): Promise<DegreeProgress> {
  return evaluateDegreeProgress(await loadProgressInput(programId));
}

export async function getRegistrationStatus(termId?: string, now = new Date()): Promise<RegistrationStatusResult> {
  let term: TermRow | null;
  if (termId) {
    term = await sqlOne<TermRow>(`SELECT ${TERM_COLS} FROM terms WHERE id = ${lit(termId)}`);
    if (!term) throw new NotFoundError(`term ${termId} not found`);
  } else {
    const today = now.toISOString().slice(0, 10);
    term = await sqlOne<TermRow>(`SELECT ${TERM_COLS} FROM terms WHERE classes_start >= ${lit(today)} ORDER BY classes_start LIMIT 1`)
      ?? await sqlOne<TermRow>(`SELECT ${TERM_COLS} FROM terms ORDER BY classes_start DESC LIMIT 1`);
  }
  if (!term) {
    return { term: null, window: computeWindow({}, now), planned_courses: [], unregistered_count: 0 };
  }
  const planned = await sqlAll<RegistrationStatusResult['planned_courses'][number]>(
    `SELECT p.id AS id, c.code AS course_code, c.title AS title, c.credits AS credits, p.status AS status, p.section AS section, p.notes AS notes
     FROM planned_courses p JOIN courses c ON c.id = p.course_id
     WHERE p.term_id = ${lit(term.id)} AND p.status <> 'dropped'
     ORDER BY c.code`,
  );
  return {
    term,
    window: computeWindow(term, now),
    planned_courses: planned,
    unregistered_count: planned.filter((p) => p.status === 'planned' || p.status === 'waitlisted').length,
  };
}

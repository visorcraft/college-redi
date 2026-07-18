import { describe, expect, it } from 'vitest';
import { evaluateDegreeProgress, type ProgressInput } from '../../src/server/degree/progress';
import type { CompletedRow, CourseRow, PlannedRow, ProgramRow, RequirementRow, TermRow } from '../../src/server/degree/repo';

let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const program = (over: Partial<ProgramRow> = {}): ProgramRow => ({
  id: id(), name: 'BS CS', institution: 'State U', catalog_year: '2024', total_credits_required: 12,
  gpa_requirement: 2.0, status: 'active', source: 'manual', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z', ...over,
});
const course = (code: string, credits = 4, over: Partial<CourseRow> = {}): CourseRow => ({
  id: id(), program_id: '', code, title: `${code} Title`, credits, description: null,
  prerequisites: [], typical_terms: [], subject: code.split(' ')[0], ...over,
});
const req = (over: Partial<RequirementRow>): RequirementRow => ({
  id: id(), program_id: '', type: 'course', course_id: null, credits_required: null,
  min_grade: null, bucket_rule: null, group_name: 'Core', description: '', sort_order: 1, ...over,
});
const done = (courseId: string, grade: string | null, credits = 4, over: Partial<CompletedRow> = {}): CompletedRow => ({
  id: id(), program_id: '', course_id: courseId, term: 'Fall 2024', year: 2024, grade,
  credits, status: 'completed', source: 'manual', created_at: '2024-01-01T00:00:00.000Z', ...over,
});
const term = (name: string, start: string): TermRow => ({
  id: id(), name, classes_start: start, classes_end: '2026-12-11', registration_opens_at: null,
  registration_closes_at: null, add_drop_deadline: null, tuition_due: null, notes: null,
});
const plan = (courseId: string, termId: string, over: Partial<PlannedRow> = {}): PlannedRow => ({
  id: id(), program_id: '', course_id: courseId, term_id: termId, status: 'planned',
  section: null, notes: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...over,
});
const input = (parts: Partial<ProgressInput>): ProgressInput => ({
  program: program(), requirements: [], courses: [], completed: [], planned: [], terms: [], ...parts,
});

describe('evaluateDegreeProgress - requirement satisfaction', () => {
  it('course requirement satisfied only when grade meets min_grade', () => {
    const c = course('CS 101');
    const r = req({ type: 'course', course_id: c.id, min_grade: 'B' });
    const fail = evaluateDegreeProgress(input({ program: program(), courses: [c], requirements: [r], completed: [done(c.id, 'B-', c.credits)] }));
    expect(fail.requirements[0].satisfied).toBe(false);
    const pass = evaluateDegreeProgress(input({ program: program(), courses: [c], requirements: [r], completed: [done(c.id, 'B+', c.credits)] }));
    expect(pass.requirements[0].satisfied).toBe(true);
    expect(pass.requirements[0].satisfied_by[0].course_code).toBe('CS 101');
  });

  it('F grades earn no credits anywhere', () => {
    const c = course('CS 101');
    const r = req({ type: 'course', course_id: c.id });
    const out = evaluateDegreeProgress(input({ courses: [c], requirements: [r], completed: [done(c.id, 'F')] }));
    expect(out.requirements[0].satisfied).toBe(false);
    expect(out.credits_completed).toBe(0);
  });

  it('bucket counts matching subjects/ranges/codes and respects credits_required', () => {
    const hum1 = course('HUM 210', 3);
    const hum2 = course('PHIL 110', 3);
    const art = course('ART 500', 3);
    const r = req({ type: 'credit_bucket', credits_required: 6, bucket_rule: { subjects: ['HUM', 'PHIL'], number_ranges: [{ min: 100, max: 499 }] } });
    const out = evaluateDegreeProgress(input({
      courses: [hum1, hum2, art], requirements: [r],
      completed: [done(hum1.id, 'A', 3), done(hum2.id, 'B', 3), done(art.id, 'A', 3)],
    }));
    expect(out.requirements[0].credits_satisfied).toBe(6);
    expect(out.requirements[0].satisfied).toBe(true);
    expect(out.requirements[0].satisfied_by.map((s) => s.course_code)).toEqual(['HUM 210', 'PHIL 110']);
  });

  it('bucket with min_grade filters out low grades', () => {
    const hum = course('HUM 210', 3);
    const r = req({ type: 'credit_bucket', credits_required: 3, min_grade: 'C', bucket_rule: { subjects: ['HUM'] } });
    const out = evaluateDegreeProgress(input({ courses: [hum], requirements: [r], completed: [done(hum.id, 'C-', 3)] }));
    expect(out.requirements[0].satisfied).toBe(false);
  });

  it('transfer credits count toward credits but not GPA; in_progress is flagged', () => {
    const a = course('CS 101');
    const b = course('HUM 100', 3);
    const out = evaluateDegreeProgress(input({
      courses: [a, b],
      requirements: [req({ type: 'course', course_id: a.id }), req({ type: 'course', course_id: b.id })],
      completed: [
        done(a.id, 'T', 4, { status: 'transfer' }),
        done(b.id, null, 3, { status: 'in_progress', term: 'Fall 2026', year: 2026 }),
      ],
    }));
    expect(out.credits_completed).toBe(4);
    expect(out.credits_in_progress).toBe(3);
    expect(out.gpa).toBeNull();
    expect(out.requirements[0].satisfied).toBe(true);
    expect(out.requirements[1].satisfied).toBe(false);
    expect(out.requirements[1].in_progress).toBe(true);
  });

  it('computes weighted GPA over graded completed courses', () => {
    const a = course('CS 101', 4);
    const b = course('HUM 100', 2);
    const out = evaluateDegreeProgress(input({ courses: [a, b], completed: [done(a.id, 'A', 4), done(b.id, 'B', 2)] }));
    expect(out.gpa).toBe(3.67);
  });

  it('milestone requirements are reported untracked and never block projection', () => {
    const out = evaluateDegreeProgress(input({ requirements: [req({ type: 'milestone', group_name: 'Capstone' })] }));
    expect(out.requirements[0].untracked).toBe(true);
    expect(out.requirements[0].satisfied).toBe(false);
    expect(out.requirements_met).toBe(true);
  });

  it('gpa requirement is tracked but does not produce uncovered-requirement flags', () => {
    const out = evaluateDegreeProgress(input({ requirements: [req({ type: 'gpa' })] }));
    expect(out.risk_flags.filter((f) => f.type === 'uncovered_requirement')).toEqual([]);
    expect(out.requirements_met).toBe(true);
  });
});

describe('evaluateDegreeProgress - projection and risk', () => {
  it('projects the first term where all requirements become coverable', () => {
    const c1 = course('CS 101');
    const c2 = course('CS 201');
    const t1 = term('Fall 2026', '2026-08-24');
    const t2 = term('Spring 2027', '2027-01-11');
    const out = evaluateDegreeProgress(input({
      program: program({ total_credits_required: 12 }),
      courses: [c1, c2],
      requirements: [req({ type: 'course', course_id: c1.id }), req({ type: 'course', course_id: c2.id })],
      completed: [done(c1.id, 'A')],
      planned: [plan(c2.id, t2.id)],
      terms: [t1, t2],
    }));
    expect(out.projected_graduation_term).toBe('Spring 2027');
    expect(out.requirements_met).toBe(false);
    expect(out.status).toBe('on_track');
  });

  it('returns null projection and no uncovered flags when everything is already done', () => {
    const c = course('CS 101');
    const out = evaluateDegreeProgress(input({
      program: program({ total_credits_required: 4 }),
      courses: [c], requirements: [req({ type: 'course', course_id: c.id })], completed: [done(c.id, 'A')],
    }));
    expect(out.projected_graduation_term).toBeNull();
    expect(out.requirements_met).toBe(true);
    expect(out.percent_complete).toBe(100);
  });

  it('flags uncovered requirements with no completed/in-progress/planned coverage', () => {
    const c = course('CS 101');
    const out = evaluateDegreeProgress(input({
      courses: [c], requirements: [
        req({ type: 'course', course_id: c.id }),
        req({ type: 'credit_bucket', group_name: 'Hum', credits_required: 6, bucket_rule: { subjects: ['HUM'] } }),
      ],
    }));
    const flags = out.risk_flags.filter((f) => f.type === 'uncovered_requirement');
    expect(flags.length).toBe(2);
    expect(out.status).toBe('at_risk');
  });

  it('flags unmet prerequisites: satisfied earlier term OK, same/later term at risk, dropped ignored', () => {
    const cs101 = course('CS 101');
    const cs201 = course('CS 201', 4, { prerequisites: ['CS 101'] });
    const t1 = term('Fall 2026', '2026-08-24');
    const t2 = term('Spring 2027', '2027-01-11');
    const ok = evaluateDegreeProgress(input({
      courses: [cs101, cs201], planned: [plan(cs101.id, t1.id), plan(cs201.id, t2.id)], terms: [t1, t2],
    }));
    expect(ok.risk_flags.filter((f) => f.type === 'unmet_prerequisite')).toEqual([]);
    const sameTerm = evaluateDegreeProgress(input({
      courses: [cs101, cs201], planned: [plan(cs101.id, t1.id), plan(cs201.id, t1.id)], terms: [t1],
    }));
    expect(sameTerm.risk_flags.some((f) => f.type === 'unmet_prerequisite')).toBe(true);
    const dropped = evaluateDegreeProgress(input({
      courses: [cs101, cs201], planned: [plan(cs101.id, t1.id, { status: 'dropped' }), plan(cs201.id, t2.id)], terms: [t1, t2],
    }));
    expect(dropped.risk_flags.some((f) => f.type === 'unmet_prerequisite')).toBe(true);
    const alreadyDone = evaluateDegreeProgress(input({
      courses: [cs101, cs201], completed: [done(cs101.id, 'A')], planned: [plan(cs201.id, t1.id)], terms: [t1],
    }));
    expect(alreadyDone.risk_flags.filter((f) => f.type === 'unmet_prerequisite')).toEqual([]);
  });

  it('flags gpa below program requirement', () => {
    const c = course('CS 101');
    const out = evaluateDegreeProgress(input({
      program: program({ gpa_requirement: 3.0 }),
      courses: [c], completed: [done(c.id, 'C')],
    }));
    expect(out.risk_flags.some((f) => f.type === 'gpa_below_requirement')).toBe(true);
  });
});

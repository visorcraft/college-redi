import { describe, expect, it } from 'vitest';
import {
  AddRequirementParams, BucketRuleSchema, CourseCode, DegreeImportDraftSchema,
  ImportDegreeAuditParams, UpdatePlannedParams, courseMatchesBucket, courseNumberOfCode,
  earnsCredits, gradeMeets, gradePoints, normalizeCourseCode, subjectOfCode,
} from '../../src/lib/schemas/degree';

describe('course code helpers', () => {
  it('accepts and normalizes codes', () => {
    expect(CourseCode.safeParse('CS 101').success).toBe(true);
    expect(CourseCode.safeParse('math151').success).toBe(true);
    expect(CourseCode.safeParse('CS').success).toBe(false);
    expect(CourseCode.safeParse('101 CS').success).toBe(false);
    expect(normalizeCourseCode('cs101')).toBe('CS 101');
    expect(normalizeCourseCode('  math  151 ')).toBe('MATH 151');
    expect(subjectOfCode('cs 201')).toBe('CS');
    expect(courseNumberOfCode('CS 1010')).toBe(1010);
  });
});

describe('grade helpers', () => {
  it('maps points and pass rules', () => {
    expect(gradePoints('a-')).toBe(3.7);
    expect(gradePoints('P')).toBeNull();
    expect(earnsCredits('F')).toBe(false);
    expect(earnsCredits('NP')).toBe(false);
    expect(earnsCredits('W')).toBe(false);
    expect(earnsCredits(null)).toBe(true);
    expect(gradeMeets('B', 'C')).toBe(true);
    expect(gradeMeets('C-', 'C')).toBe(false);
    expect(gradeMeets(null, 'C')).toBe(false);
    expect(gradeMeets(null, null)).toBe(true);
    expect(gradeMeets('T', 'A')).toBe(true);
    expect(gradeMeets('P', 'B')).toBe(true);
  });
});

describe('bucket rules', () => {
  it('requires at least one selector', () => {
    expect(BucketRuleSchema.safeParse({}).success).toBe(false);
    expect(BucketRuleSchema.safeParse({ subjects: ['HUM'] }).success).toBe(true);
  });
  it('matches by subjects, ranges, explicit codes, and combinations', () => {
    const hum = { code: 'HUM 210', subject: 'HUM' };
    const cs = { code: 'CS 101', subject: 'CS' };
    expect(courseMatchesBucket({ subjects: ['HUM'] }, hum)).toBe(true);
    expect(courseMatchesBucket({ subjects: ['HUM'] }, cs)).toBe(false);
    expect(courseMatchesBucket({ number_ranges: [{ min: 200, max: 499 }] }, hum)).toBe(true);
    expect(courseMatchesBucket({ number_ranges: [{ min: 200, max: 499 }] }, cs)).toBe(false);
    expect(courseMatchesBucket({ course_codes: ['cs101'] }, cs)).toBe(true);
    expect(courseMatchesBucket({ subjects: ['HUM'], number_ranges: [{ min: 300, max: 499 }] }, hum)).toBe(false);
    expect(courseMatchesBucket({ course_codes: ['HUM 210'], subjects: ['CS'] }, hum)).toBe(true);
  });
});

describe('tool params', () => {
  it('validates requirement shapes loosely (type rules enforced by handler)', () => {
    expect(AddRequirementParams.safeParse({ program_id: crypto.randomUUID(), type: 'credit_bucket', group_name: 'Core' }).success).toBe(true);
    expect(AddRequirementParams.safeParse({ program_id: 'nope', type: 'course', group_name: 'Core' }).success).toBe(false);
  });
  it('restricts registration status values', () => {
    expect(UpdatePlannedParams.safeParse({ id: crypto.randomUUID(), status: 'registered' }).success).toBe(true);
    expect(UpdatePlannedParams.safeParse({ id: crypto.randomUUID(), status: 'enrolled' }).success).toBe(false);
  });
  it('requires text or file for import', () => {
    expect(ImportDegreeAuditParams.safeParse({}).success).toBe(false);
    expect(ImportDegreeAuditParams.safeParse({ text: 'audit...' }).success).toBe(true);
  });
});

describe('DegreeImportDraftSchema', () => {
  it('parses a minimal valid draft and applies defaults', () => {
    const draft = DegreeImportDraftSchema.parse({
      program: { name: 'BS Computer Science', institution: 'State University', total_credits_required: 120 },
      requirements: [{ type: 'course', course_code: 'CS 101', group_name: 'Core' }],
      courses: [{ code: 'CS 101', title: 'Intro to CS', credits: 4 }],
      completed_courses: [{ course_code: 'CS 101', term: 'Fall 2024', year: 2024, credits: 4 }],
    });
    expect(draft.completed_courses[0].status).toBe('completed');
    expect(draft.confidence_flags).toEqual([]);
  });
  it('rejects non-integer credits', () => {
    expect(DegreeImportDraftSchema.safeParse({
      program: { name: 'X', institution: 'Y', total_credits_required: 120.5 },
    }).success).toBe(false);
  });
});

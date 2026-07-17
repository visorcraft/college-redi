import { z } from 'zod';

export const GRADE_POINTS: Record<string, number> = {
  A: 4.0, 'A-': 3.7, 'B+': 3.3, B: 3.0, 'B-': 2.7,
  'C+': 2.3, C: 2.0, 'C-': 1.7, 'D+': 1.3, D: 1.0, 'D-': 0.7, F: 0.0,
};
const NO_CREDIT_GRADES = new Set(['F', 'NP', 'W']);

export function gradePoints(grade: string | null | undefined): number | null {
  if (!grade) return null;
  const g = grade.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(GRADE_POINTS, g) ? GRADE_POINTS[g] : null;
}
export function earnsCredits(grade: string | null | undefined): boolean {
  if (!grade) return true;
  return !NO_CREDIT_GRADES.has(grade.trim().toUpperCase());
}
export function gradeMeets(grade: string | null | undefined, min: string | null | undefined): boolean {
  if (!min) return true;
  const g = grade?.trim().toUpperCase() ?? '';
  if (g === 'P' || g === 'T') return true;
  const pts = gradePoints(g);
  const minPts = gradePoints(min);
  if (pts === null || minPts === null) return false;
  return pts >= minPts;
}

export const CourseCode = z.string().trim().min(2).max(20)
  .regex(/^[A-Za-z]{1,8}\s?\d{1,4}[A-Za-z]?$/, 'expected a course code like "CS 101"');

export function normalizeCourseCode(code: string): string {
  const flat = code.trim().toUpperCase().replace(/\s+/g, ' ');
  const m = /^([A-Z]{1,8})\s?(\d{1,4}[A-Z]?)$/.exec(flat);
  return m ? `${m[1]} ${m[2]}` : flat;
}
export function subjectOfCode(code: string): string {
  return normalizeCourseCode(code).split(' ')[0] ?? '';
}
export function courseNumberOfCode(code: string): number {
  const m = /(\d{1,4})/.exec(normalizeCourseCode(code));
  return m ? Number(m[1]) : 0;
}

export const RequirementTypeSchema = z.enum(['course', 'credit_bucket', 'gpa', 'milestone']);
export const RegistrationStatusSchema = z.enum(['planned', 'registered', 'waitlisted', 'dropped', 'completed']);
export const CompletedStatusSchema = z.enum(['completed', 'in_progress', 'transfer']);
export const ProgramStatusSchema = z.enum(['active', 'completed', 'abandoned']);
export const CompletedSourceSchema = z.enum(['manual', 'import', 'email']);
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const IsoTimestamp = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'expected an ISO timestamp');
const uuid = z.string().uuid();

export const BucketRuleSchema = z.object({
  subjects: z.array(z.string().trim().min(1).max(12)).optional(),
  number_ranges: z.array(z.object({ min: z.number().int().min(0).max(9999), max: z.number().int().min(0).max(9999) })).optional(),
  course_codes: z.array(CourseCode).optional(),
}).refine((r) => Boolean(r.subjects?.length || r.number_ranges?.length || r.course_codes?.length), {
  message: 'bucket_rule needs subjects, number_ranges, or course_codes',
});
export type BucketRule = z.infer<typeof BucketRuleSchema>;

export function courseMatchesBucket(rule: BucketRule, course: { code: string; subject: string }): boolean {
  const code = normalizeCourseCode(course.code);
  if (rule.course_codes?.some((c) => normalizeCourseCode(c) === code)) return true;
  if (!rule.subjects?.length && !rule.number_ranges?.length) return false;
  if (rule.subjects?.length && !rule.subjects.map((s) => s.toUpperCase()).includes(course.subject.toUpperCase())) return false;
  if (rule.number_ranges?.length) {
    const n = courseNumberOfCode(code);
    if (!rule.number_ranges.some((r) => n >= r.min && n <= r.max)) return false;
  }
  return true;
}

export const ListProgramsParams = z.object({ status: ProgramStatusSchema.optional() });
export const GetProgramParams = z.object({ id: uuid });
export const CreateProgramParams = z.object({
  name: z.string().trim().min(1).max(200),
  institution: z.string().trim().min(1).max(200),
  catalog_year: z.string().trim().max(20).optional(),
  total_credits_required: z.number().int().positive().max(400),
  gpa_requirement: z.number().min(0).max(5).optional(),
  status: ProgramStatusSchema.optional(),
});
export const UpdateProgramParams = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(200).optional(),
  institution: z.string().trim().min(1).max(200).optional(),
  catalog_year: z.string().trim().max(20).nullable().optional(),
  total_credits_required: z.number().int().positive().max(400).optional(),
  gpa_requirement: z.number().min(0).max(5).nullable().optional(),
  status: ProgramStatusSchema.optional(),
});
export const DeleteProgramParams = z.object({ id: uuid, confirm: z.boolean().optional() });

const requirementFields = {
  type: RequirementTypeSchema,
  course_id: uuid.optional(),
  credits_required: z.number().int().positive().max(400).optional(),
  min_grade: z.string().trim().max(10).optional(),
  bucket_rule: BucketRuleSchema.optional(),
  group_name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  sort_order: z.number().int().min(0).optional(),
};
export const ListRequirementsParams = z.object({ program_id: uuid });
export const AddRequirementParams = z.object({ program_id: uuid, ...requirementFields });
export const UpdateRequirementParams = z.object({ id: uuid, ...requirementFields }).partial().required({ id: true });
export const DeleteRequirementParams = z.object({ id: uuid, confirm: z.boolean().optional() });

const courseFields = {
  code: CourseCode,
  title: z.string().trim().min(1).max(200),
  credits: z.number().int().min(0).max(30),
  description: z.string().trim().max(2000).optional(),
  prerequisites: z.array(CourseCode).max(20).optional(),
  typical_terms: z.array(z.string().trim().min(1).max(20)).max(8).optional(),
};
export const ListCoursesParams = z.object({ program_id: uuid, subject: z.string().trim().max(12).optional() });
export const AddCourseParams = z.object({ program_id: uuid, ...courseFields });
export const UpdateCourseParams = z.object({ id: uuid, ...courseFields }).partial().required({ id: true });
export const DeleteCourseParams = z.object({ id: uuid, confirm: z.boolean().optional() });

export const MarkCompletedParams = z.object({
  program_id: uuid,
  course_id: uuid,
  term: z.string().trim().min(1).max(30),
  year: z.number().int().min(1900).max(2200),
  grade: z.string().trim().max(3).optional(),
  credits: z.number().int().min(0).max(30).optional(),
  status: CompletedStatusSchema.optional(),
  source: CompletedSourceSchema.optional(),
});
export const UnmarkCompletedParams = z.object({ id: uuid });

export const PlanCourseParams = z.object({
  program_id: uuid,
  course_id: uuid,
  term_id: uuid,
  section: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
});
export const UpdatePlannedParams = z.object({
  id: uuid,
  status: RegistrationStatusSchema.optional(),
  section: z.string().trim().max(20).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
export const RemovePlannedParams = z.object({ id: uuid, confirm: z.boolean().optional() });

export const ListTermsParams = z.object({});
const termFields = {
  name: z.string().trim().min(1).max(60),
  classes_start: IsoDate,
  classes_end: IsoDate,
  registration_opens_at: IsoTimestamp.nullable().optional(),
  registration_closes_at: IsoTimestamp.nullable().optional(),
  add_drop_deadline: IsoTimestamp.nullable().optional(),
  tuition_due: IsoTimestamp.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
};
export const UpsertTermParams = z.object({ id: uuid.optional(), ...termFields });
export const DeleteTermParams = z.object({ id: uuid, confirm: z.boolean().optional() });

export const GetDegreeProgressParams = z.object({ program_id: uuid.optional() });
export const GetRegistrationStatusParams = z.object({ term_id: uuid.optional() });

export const ImportRequirementSchema = z.object({
  type: RequirementTypeSchema,
  course_code: CourseCode.optional(),
  credits_required: z.number().int().positive().max(400).optional(),
  min_grade: z.string().trim().max(10).optional(),
  bucket_rule: BucketRuleSchema.optional(),
  group_name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  sort_order: z.number().int().min(0).optional(),
});
export const ImportCourseSchema = z.object({
  code: CourseCode,
  title: z.string().trim().min(1).max(200),
  credits: z.number().int().min(0).max(30),
  description: z.string().trim().max(2000).optional(),
  prerequisites: z.array(CourseCode).max(20).optional(),
  typical_terms: z.array(z.string().trim().min(1).max(20)).max(8).optional(),
});
export const ImportCompletedSchema = z.object({
  course_code: CourseCode,
  term: z.string().trim().min(1).max(30),
  year: z.number().int().min(1900).max(2200),
  grade: z.string().trim().max(3).optional(),
  credits: z.number().int().min(0).max(30),
  status: CompletedStatusSchema.default('completed'),
});
export const DegreeImportDraftSchema = z.object({
  program: z.object({
    name: z.string().trim().min(1).max(200),
    institution: z.string().trim().min(1).max(200),
    catalog_year: z.string().trim().max(20).optional(),
    total_credits_required: z.number().int().positive().max(400),
    gpa_requirement: z.number().min(0).max(5).optional(),
  }),
  requirements: z.array(ImportRequirementSchema).default([]),
  courses: z.array(ImportCourseSchema).default([]),
  completed_courses: z.array(ImportCompletedSchema).default([]),
  confidence_flags: z.array(z.object({ path: z.string(), message: z.string() })).default([]),
});
export type DegreeImportDraft = z.infer<typeof DegreeImportDraftSchema>;

export const ImportDegreeAuditParams = z.object({
  text: z.string().max(200_000).optional(),
  file_base64: z.string().max(14_000_000).optional(),
  filename: z.string().max(255).optional(),
}).refine((v) => Boolean(v.text?.trim() || v.file_base64), { message: 'provide text or file_base64' });
export const ConfirmDegreeImportParams = z.object({ draft: DegreeImportDraftSchema });

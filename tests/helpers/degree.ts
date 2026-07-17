import { insertRow, newId, nowIso } from '../../src/server/degree/repo';

export async function seedProgram(overrides: Partial<{ id: string; name: string; total_credits_required: number; gpa_requirement: number | null; status: string }> = {}): Promise<string> {
  const id = overrides.id ?? newId();
  const now = nowIso();
  await insertRow('degree_programs', {
    id, name: overrides.name ?? 'BS Computer Science', institution: 'State University',
    catalog_year: '2024', total_credits_required: overrides.total_credits_required ?? 120,
    gpa_requirement: overrides.gpa_requirement === undefined ? 2.0 : overrides.gpa_requirement,
    status: overrides.status ?? 'active', source: 'manual', created_at: now, updated_at: now,
  });
  return id;
}

export async function seedCourse(programId: string, code = 'CS 101', overrides: Partial<{ title: string; credits: number; subject: string; prerequisites: string[] }> = {}): Promise<string> {
  const id = newId();
  await insertRow('courses', {
    id, program_id: programId, code, title: overrides.title ?? `${code} Course`, credits: overrides.credits ?? 4,
    description: null, prerequisites: JSON.stringify(overrides.prerequisites ?? []),
    typical_terms: JSON.stringify(['fall', 'spring']), subject: overrides.subject ?? code.split(' ')[0],
  });
  return id;
}

export async function seedTerm(name = 'Fall 2026', classesStart = '2026-08-24', classesEnd = '2026-12-11'): Promise<string> {
  const id = newId();
  await insertRow('terms', {
    id, name, classes_start: classesStart, classes_end: classesEnd,
    registration_opens_at: null, registration_closes_at: null, add_drop_deadline: null, tuition_due: null, notes: null,
  });
  return id;
}

export async function seedRequirement(programId: string, overrides: Record<string, string | number | null> = {}): Promise<string> {
  const id = newId();
  await insertRow('requirements', {
    id, program_id: programId, type: 'milestone', course_id: null, credits_required: null,
    min_grade: null, bucket_rule: null, group_name: 'General', description: '', sort_order: 1, ...overrides,
  });
  return id;
}

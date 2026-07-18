'use client';

import { useState } from 'react';
import {
  del, patch, post, type BucketRule, type CompletedCourseRow, type CourseRow,
  type ProgramRow, type RequirementRow,
} from './api';
import { parseCourseNumberRanges } from '../../lib/schemas/degree';

const inputCls = 'rounded-lg border border-[#C9DAEC] bg-white p-2 text-sm text-[#1F2D50]';
const primaryBtn = 'rounded-xl bg-[#1F2D50] px-3 py-2 text-sm font-medium text-white';
const quietBtn = 'rounded-xl bg-[#EAF3FB] px-3 py-2 text-sm font-medium text-[#1F2D50]';
const dangerBtn = 'text-sm text-[#B3261E] underline';

export function ProgramForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const program = await post<ProgramRow>('/api/programs', {
        name: String(f.get('name') ?? ''),
        institution: String(f.get('institution') ?? ''),
        catalog_year: String(f.get('catalog_year') ?? '') || undefined,
        total_credits_required: Number(f.get('total_credits_required') ?? 0),
        gpa_requirement: f.get('gpa_requirement') ? Number(f.get('gpa_requirement')) : undefined,
      });
      onCreated(program.id);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  return (
    <form onSubmit={submit} aria-label="add program" className="mx-auto max-w-xl space-y-3 rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-[#1F2D50]">Add your program</h2>
      <label className="block text-sm text-[#1F2D50]">Program name<input name="name" required className={inputCls + ' mt-1 w-full'} placeholder="BS Computer Science" /></label>
      <label className="block text-sm text-[#1F2D50]">Institution<input name="institution" required className={inputCls + ' mt-1 w-full'} placeholder="State University" /></label>
      <label className="block text-sm text-[#1F2D50]">Catalog year<input name="catalog_year" className={inputCls + ' mt-1 w-full'} placeholder="2024" /></label>
      <label className="block text-sm text-[#1F2D50]">Total credits required<input name="total_credits_required" required type="number" min={1} className={inputCls + ' mt-1 w-full'} placeholder="120" /></label>
      <label className="block text-sm text-[#1F2D50]">GPA requirement (optional)<input name="gpa_requirement" type="number" step="0.1" min={0} max={5} className={inputCls + ' mt-1 w-full'} placeholder="2.0" /></label>
      {error && <p role="alert" className="text-sm text-[#B3261E]">{error}</p>}
      <button type="submit" className="rounded-xl bg-[#1F2D50] px-4 py-2 font-medium text-white">Create program</button>
    </form>
  );
}

const csv = (text: string): string[] => text.split(',').map((s) => s.trim()).filter(Boolean);

function ProgramEditor({
  program,
  onChanged,
  onDeleted,
  onError,
}: {
  program: ProgramRow;
  onChanged: () => void;
  onDeleted: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await patch(`/api/programs/${program.id}`, {
        name: String(f.get('name') ?? ''),
        institution: String(f.get('institution') ?? ''),
        catalog_year: String(f.get('catalog_year') ?? '') || null,
        total_credits_required: Number(f.get('total_credits_required') ?? 0),
        gpa_requirement: f.get('gpa_requirement') ? Number(f.get('gpa_requirement')) : null,
        status: String(f.get('status') ?? 'active'),
      });
      setEditing(false);
      onChanged();
    } catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  }
  async function remove() {
    if (!window.confirm(`Delete ${program.name} and its degree-plan data?`)) return;
    try {
      await del(`/api/programs/${program.id}`, { confirm: true });
      onDeleted(program.id);
    } catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  }
  if (!editing) {
    return (
      <div aria-label="program details" className="flex flex-col gap-3 rounded-xl border border-[#EAF3FB] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-[#1F2D50]">
          <p className="font-medium">{program.name}</p>
          <p className="text-[#5A6B8C]">{program.institution}{program.catalog_year ? ` · catalog ${program.catalog_year}` : ''} · {program.total_credits_required} credits</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => setEditing(true)} className={quietBtn}>Edit program</button>
          <button type="button" onClick={remove} className={dangerBtn}>Delete program</button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={save} aria-label="edit program details" className="grid gap-3 rounded-xl border border-[#C9DAEC] p-4 sm:grid-cols-2">
      <label className="text-sm text-[#1F2D50]">Program name<input name="name" required defaultValue={program.name} className={inputCls + ' mt-1 w-full'} /></label>
      <label className="text-sm text-[#1F2D50]">Institution<input name="institution" required defaultValue={program.institution} className={inputCls + ' mt-1 w-full'} /></label>
      <label className="text-sm text-[#1F2D50]">Catalog year<input name="catalog_year" defaultValue={program.catalog_year ?? ''} className={inputCls + ' mt-1 w-full'} /></label>
      <label className="text-sm text-[#1F2D50]">Total credits required<input name="total_credits_required" type="number" min={1} required defaultValue={program.total_credits_required} className={inputCls + ' mt-1 w-full'} /></label>
      <label className="text-sm text-[#1F2D50]">GPA requirement<input name="gpa_requirement" type="number" min={0} max={5} step="0.1" defaultValue={program.gpa_requirement ?? ''} className={inputCls + ' mt-1 w-full'} /></label>
      <label className="text-sm text-[#1F2D50]">Program status
        <select name="status" defaultValue={program.status} className={inputCls + ' mt-1 w-full'}>
          <option value="active">active</option>
          <option value="completed">completed</option>
          <option value="abandoned">abandoned</option>
        </select>
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={primaryBtn}>Save program</button>
        <button type="button" onClick={() => setEditing(false)} className={quietBtn}>Cancel</button>
      </div>
    </form>
  );
}

function CourseList({
  courses,
  onChanged,
  onError,
}: {
  courses: CourseRow[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  async function save(course: CourseRow, form: HTMLFormElement) {
    const f = new FormData(form);
    try {
      await patch(`/api/courses/${course.id}`, {
        code: String(f.get('code') ?? ''),
        title: String(f.get('title') ?? ''),
        credits: Number(f.get('credits') ?? 0),
        description: String(f.get('description') ?? ''),
        prerequisites: csv(String(f.get('prerequisites') ?? '')),
        typical_terms: csv(String(f.get('typical_terms') ?? '')),
      });
      onChanged();
    } catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  }
  async function remove(course: CourseRow) {
    if (!window.confirm(`Delete ${course.code}?`)) return;
    try {
      await del(`/api/courses/${course.id}`, { confirm: true });
      onChanged();
    } catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  }
  return (
    <div>
      <h3 className="mb-2 font-medium text-[#1F2D50]">Course catalog ({courses.length})</h3>
      {courses.length === 0 && <p className="text-sm text-[#5A6B8C]">No courses yet.</p>}
      <ul className="space-y-2">
        {courses.map((course) => (
          <li key={`${course.id}:${course.code}:${course.title}:${course.credits}`} className="rounded-xl border border-[#EAF3FB] p-3 text-sm text-[#1F2D50]">
            <details>
              <summary className="cursor-pointer font-medium">{course.code} · {course.title} ({course.credits} cr)</summary>
              <form
                aria-label={`edit course ${course.code}`}
                onSubmit={(e) => { e.preventDefault(); void save(course, e.currentTarget); }}
                className="mt-3 grid gap-2 sm:grid-cols-2"
              >
                <label>Course code<input aria-label={`Course code for ${course.code}`} name="code" required defaultValue={course.code} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Course title<input aria-label={`Course title for ${course.code}`} name="title" required defaultValue={course.title} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Course credits<input aria-label={`Course credits for ${course.code}`} name="credits" type="number" min={0} required defaultValue={course.credits} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Description<input name="description" defaultValue={course.description ?? ''} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Prerequisites<input name="prerequisites" defaultValue={course.prerequisites.join(', ')} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Typical terms<input name="typical_terms" defaultValue={course.typical_terms.join(', ')} className={inputCls + ' mt-1 w-full'} /></label>
                <div className="flex gap-3 sm:col-span-2">
                  <button type="submit" className={primaryBtn}>Save course</button>
                  <button type="button" onClick={() => remove(course)} className={dangerBtn}>Delete course</button>
                </div>
              </form>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequirementList({
  requirements,
  courses,
  onChanged,
  onError,
}: {
  requirements: RequirementRow[];
  courses: CourseRow[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const codeFor = (id: string | null) => courses.find((course) => course.id === id)?.code;
  async function save(requirement: RequirementRow, form: HTMLFormElement) {
    const f = new FormData(form);
    const body: Record<string, unknown> = {
      group_name: String(f.get('group_name') ?? ''),
      description: String(f.get('description') ?? ''),
      min_grade: String(f.get('min_grade') ?? ''),
      sort_order: Number(f.get('sort_order') ?? 0),
    };
    if (requirement.type === 'course') body.course_id = String(f.get('course_id') ?? '');
    if (requirement.type === 'credit_bucket') {
      const ranges = parseCourseNumberRanges(String(f.get('bucket_ranges') ?? ''));
      if (ranges === null) {
        onError('Use number ranges like 100-299, 400-499.');
        return;
      }
      body.credits_required = Number(f.get('credits_required') ?? 0);
      body.bucket_rule = {
        subjects: csv(String(f.get('bucket_subjects') ?? '')),
        number_ranges: ranges,
        course_codes: csv(String(f.get('bucket_codes') ?? '')),
      };
    }
    try {
      await patch(`/api/requirements/${requirement.id}`, body);
      onChanged();
    } catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  }
  async function remove(requirement: RequirementRow) {
    if (!window.confirm(`Delete this ${requirement.type} requirement?`)) return;
    try {
      await del(`/api/requirements/${requirement.id}`, { confirm: true });
      onChanged();
    } catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  }
  return (
    <div>
      <h3 className="mb-2 font-medium text-[#1F2D50]">Requirement rules ({requirements.length})</h3>
      {requirements.length === 0 && <p className="text-sm text-[#5A6B8C]">No requirements yet.</p>}
      <ul className="space-y-2">
        {requirements.map((requirement) => (
          <li key={`${requirement.id}:${requirement.group_name}:${requirement.description}:${requirement.sort_order}`} className="rounded-xl border border-[#EAF3FB] p-3 text-sm text-[#1F2D50]">
            <details>
              <summary className="cursor-pointer font-medium">
                {requirement.group_name} · {requirement.type}
                {requirement.type === 'course' && codeFor(requirement.course_id) ? ` · ${codeFor(requirement.course_id)}` : ''}
                {requirement.type === 'credit_bucket' ? ` · ${requirement.credits_required} credits` : ''}
              </summary>
              <form
                aria-label={`edit requirement ${requirement.id}`}
                onSubmit={(e) => { e.preventDefault(); void save(requirement, e.currentTarget); }}
                className="mt-3 grid gap-2 sm:grid-cols-2"
              >
                {requirement.type === 'course' && (
                  <label>Course
                    <select name="course_id" defaultValue={requirement.course_id ?? ''} required className={inputCls + ' mt-1 w-full'}>
                      {courses.map((course) => <option key={course.id} value={course.id}>{course.code}</option>)}
                    </select>
                  </label>
                )}
                {requirement.type === 'credit_bucket' && (
                  <>
                    <label>Credits required<input name="credits_required" type="number" min={1} required defaultValue={requirement.credits_required ?? ''} className={inputCls + ' mt-1 w-full'} /></label>
                    <label>Subjects<input name="bucket_subjects" defaultValue={requirement.bucket_rule?.subjects?.join(', ') ?? ''} className={inputCls + ' mt-1 w-full'} /></label>
                    <label>Number ranges<input name="bucket_ranges" defaultValue={requirement.bucket_rule?.number_ranges?.map((range) => `${range.min}-${range.max}`).join(', ') ?? ''} className={inputCls + ' mt-1 w-full'} /></label>
                    <label>Explicit codes<input name="bucket_codes" defaultValue={requirement.bucket_rule?.course_codes?.join(', ') ?? ''} className={inputCls + ' mt-1 w-full'} /></label>
                  </>
                )}
                <label>Group<input name="group_name" required defaultValue={requirement.group_name} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Min grade<input name="min_grade" defaultValue={requirement.min_grade ?? ''} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Description<input name="description" defaultValue={requirement.description} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Sort order<input name="sort_order" type="number" min={0} defaultValue={requirement.sort_order} className={inputCls + ' mt-1 w-full'} /></label>
                <div className="flex gap-3 sm:col-span-2">
                  <button type="submit" className={primaryBtn}>Save requirement</button>
                  <button type="button" onClick={() => remove(requirement)} className={dangerBtn}>Delete requirement</button>
                </div>
              </form>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompletedCourses({
  programId,
  courses,
  completed,
  onChanged,
  onError,
}: {
  programId: string;
  courses: CourseRow[];
  completed: CompletedCourseRow[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  async function mark(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await post('/api/completed-courses', {
        program_id: programId,
        course_id: String(f.get('course_id') ?? ''),
        term: String(f.get('term') ?? ''),
        year: Number(f.get('year') ?? 0),
        grade: String(f.get('grade') ?? '') || undefined,
        status: String(f.get('status') ?? 'completed'),
      });
      form.reset();
      onChanged();
    } catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  }
  async function unmark(course: CompletedCourseRow) {
    if (!window.confirm(`Unmark ${course.course_code} for ${course.term} ${course.year}?`)) return;
    try {
      await del(`/api/completed-courses/${course.id}`);
      onChanged();
    } catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  }
  return (
    <div>
      <h3 className="mb-2 font-medium text-[#1F2D50]">Completed and in-progress courses</h3>
      {courses.length > 0 && (
        <form onSubmit={mark} aria-label="mark course completed" className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm text-[#1F2D50]">Course
            <select aria-label="completed course" name="course_id" required className={inputCls + ' mt-1 block'}>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.code}</option>)}
            </select>
          </label>
          <label className="text-sm text-[#1F2D50]">Term<input name="term" required placeholder="Fall" className={inputCls + ' mt-1 block w-28'} /></label>
          <label className="text-sm text-[#1F2D50]">Year<input name="year" type="number" min={1900} max={2200} required defaultValue={new Date().getFullYear()} className={inputCls + ' mt-1 block w-24'} /></label>
          <label className="text-sm text-[#1F2D50]">Grade<input name="grade" maxLength={3} className={inputCls + ' mt-1 block w-20'} /></label>
          <label className="text-sm text-[#1F2D50]">Completion status
            <select name="status" className={inputCls + ' mt-1 block'}>
              <option value="completed">completed</option>
              <option value="in_progress">in progress</option>
              <option value="transfer">transfer</option>
            </select>
          </label>
          <button type="submit" className={primaryBtn}>Mark course</button>
        </form>
      )}
      {completed.length === 0 && <p className="text-sm text-[#5A6B8C]">No completed courses recorded.</p>}
      <ul className="space-y-2">
        {completed.map((course) => (
          <li key={course.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EAF3FB] p-3 text-sm text-[#1F2D50]">
            <span><strong>{course.course_code}</strong> · {course.term} {course.year}{course.grade ? ` · ${course.grade}` : ''} · {course.status.replace('_', ' ')}</span>
            <button type="button" onClick={() => unmark(course)} aria-label={`unmark ${course.course_code} ${course.term} ${course.year}`} className={dangerBtn}>Unmark</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ManualBuilder({
  program,
  courses,
  requirements,
  completed,
  onChanged,
  onProgramDeleted,
}: {
  program: ProgramRow;
  courses: CourseRow[];
  requirements: RequirementRow[];
  completed: CompletedCourseRow[];
  onChanged: () => void;
  onProgramDeleted: (id: string) => void;
}) {
  const programId = program.id;
  const [reqType, setReqType] = useState('course');
  const [error, setError] = useState<string | null>(null);
  const changed = () => {
    setError(null);
    onChanged();
  };

  async function addCourse(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await post('/api/courses', {
        program_id: programId,
        code: String(f.get('code') ?? ''),
        title: String(f.get('title') ?? ''),
        credits: Number(f.get('credits') ?? 0),
        description: String(f.get('course_description') ?? '') || undefined,
        prerequisites: csv(String(f.get('prerequisites') ?? '')),
        typical_terms: csv(String(f.get('typical_terms') ?? '')),
      });
      form.reset();
      changed();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function addRequirement(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const bucket_rule: BucketRule = {};
    const subjects = csv(String(f.get('bucket_subjects') ?? ''));
    const ranges = parseCourseNumberRanges(String(f.get('bucket_ranges') ?? ''));
    const codes = csv(String(f.get('bucket_codes') ?? ''));
    if (ranges === null) {
      setError('Use number ranges like 100-299, 400-499.');
      return;
    }
    if (subjects.length) bucket_rule.subjects = subjects;
    if (String(f.get('bucket_ranges') ?? '').trim()) bucket_rule.number_ranges = ranges;
    if (codes.length) bucket_rule.course_codes = codes;
    try {
      await post('/api/requirements', {
        program_id: programId,
        type: reqType,
        course_id: reqType === 'course' ? String(f.get('course_id') ?? '') || undefined : undefined,
        credits_required: reqType === 'credit_bucket' ? Number(f.get('credits_required') ?? 0) : undefined,
        min_grade: String(f.get('min_grade') ?? '') || undefined,
        bucket_rule: reqType === 'credit_bucket' ? bucket_rule : undefined,
        group_name: String(f.get('group_name') ?? ''),
        description: String(f.get('description') ?? '') || undefined,
      });
      form.reset();
      setReqType('course');
      changed();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  return (
    <section aria-label="edit program" className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-[#1F2D50]">Manage your program</h2>
      <ProgramEditor program={program} onChanged={changed} onDeleted={onProgramDeleted} onError={setError} />
      <div className="space-y-3 border-t border-[#EAF3FB] pt-4">
        <h3 className="font-medium text-[#1F2D50]">Add a course</h3>
      <form onSubmit={addCourse} aria-label="add course" className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-[#1F2D50]">Course code<input name="code" required placeholder="CS 101" className={inputCls + ' mt-1 block w-28'} /></label>
        <label className="text-sm text-[#1F2D50]">Title<input name="title" required placeholder="Intro to CS" className={inputCls + ' mt-1 block w-48'} /></label>
        <label className="text-sm text-[#1F2D50]">Credits<input name="credits" required type="number" min={0} className={inputCls + ' mt-1 block w-20'} /></label>
        <label className="text-sm text-[#1F2D50]">Prerequisites (comma-separated)<input name="prerequisites" placeholder="MATH 151" className={inputCls + ' mt-1 block w-40'} /></label>
        <label className="text-sm text-[#1F2D50]">Typical terms<input name="typical_terms" placeholder="fall, spring" className={inputCls + ' mt-1 block w-32'} /></label>
        <label className="text-sm text-[#1F2D50]">Course description<input name="course_description" className={inputCls + ' mt-1 block w-48'} /></label>
        <button type="submit" className={primaryBtn}>Add course</button>
      </form>
      <CourseList courses={courses} onChanged={changed} onError={setError} />
      </div>
      <div className="space-y-3 border-t border-[#EAF3FB] pt-4">
        <h3 className="font-medium text-[#1F2D50]">Add a requirement</h3>
      <form onSubmit={addRequirement} aria-label="add requirement" className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-[#1F2D50]">Type
          <select aria-label="requirement type" value={reqType} onChange={(e) => setReqType(e.target.value)} className={inputCls + ' mt-1 block'}>
            <option value="course">course</option>
            <option value="credit_bucket">credit_bucket</option>
            <option value="gpa">gpa</option>
            <option value="milestone">milestone</option>
          </select>
        </label>
        {reqType === 'course' && (
          <label className="text-sm text-[#1F2D50]">Course
            <select aria-label="requirement course" name="course_id" required className={inputCls + ' mt-1 block'}>
              <option value="">— pick —</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
          </label>
        )}
        {reqType === 'credit_bucket' && (
          <>
            <label className="text-sm text-[#1F2D50]">Credits required<input name="credits_required" required type="number" min={1} className={inputCls + ' mt-1 block w-24'} /></label>
            <label className="text-sm text-[#1F2D50]">Subjects<input name="bucket_subjects" placeholder="HUM, PHIL" className={inputCls + ' mt-1 block w-32'} /></label>
            <label className="text-sm text-[#1F2D50]">Number ranges<input name="bucket_ranges" placeholder="100-499" className={inputCls + ' mt-1 block w-32'} /></label>
            <label className="text-sm text-[#1F2D50]">Or explicit codes<input name="bucket_codes" placeholder="HIST 220, INTL 310" className={inputCls + ' mt-1 block w-40'} /></label>
          </>
        )}
        <label className="text-sm text-[#1F2D50]">Group<input name="group_name" required placeholder="Core" className={inputCls + ' mt-1 block w-32'} /></label>
        <label className="text-sm text-[#1F2D50]">Min grade<input name="min_grade" placeholder="C" className={inputCls + ' mt-1 block w-16'} /></label>
        <label className="text-sm text-[#1F2D50]">Description<input name="description" className={inputCls + ' mt-1 block w-48'} /></label>
        <button type="submit" className={primaryBtn}>Add requirement</button>
      </form>
      <RequirementList requirements={requirements} courses={courses} onChanged={changed} onError={setError} />
      </div>
      <div className="border-t border-[#EAF3FB] pt-4">
        <CompletedCourses
          programId={programId}
          courses={courses}
          completed={completed}
          onChanged={changed}
          onError={setError}
        />
      </div>
      {error && <p role="alert" className="text-sm text-[#B3261E]">{error}</p>}
    </section>
  );
}

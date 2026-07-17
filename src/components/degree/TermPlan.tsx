'use client';

import { useEffect, useState } from 'react';
import { api, del, patch, post, type CourseRow, type PlannedJoined, type RegistrationStatusResult, type TermRow } from './api';

const inputCls = 'rounded-lg border border-[#C9DAEC] bg-white p-2 text-sm text-[#1F2D50]';
const STATUSES = ['planned', 'registered', 'waitlisted', 'dropped', 'completed'] as const;

function windowBadge(w: RegistrationStatusResult['window']): string {
  if (w.state === 'not_scheduled') return 'window not scheduled';
  if (w.state === 'upcoming') return `registration opens in ${w.days_until_open}d`;
  if (w.state === 'open') return w.days_until_close !== null ? `registration open — closes in ${w.days_until_close}d` : 'registration open';
  return 'registration closed';
}

function TermCard({ term, programId, courses, planned, onChanged }: { term: TermRow; programId: string; courses: CourseRow[]; planned: PlannedJoined[]; onChanged: () => void }) {
  const [status, setStatus] = useState<RegistrationStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<RegistrationStatusResult>(`/api/planned-courses?term_id=${term.id}`)
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, [term.id]);
  const rows = planned.filter((p) => p.term_id === term.id);
  const plannedCourseIds = new Set(rows.map((r) => r.course_id));
  const addable = courses.filter((c) => !plannedCourseIds.has(c.id));

  async function addPlanned(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const courseId = String(f.get('course_id') ?? '');
    if (!courseId) return;
    try {
      await post('/api/planned-courses', { program_id: programId, course_id: courseId, term_id: term.id });
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  async function setRegStatus(id: string, value: string) {
    try { await patch(`/api/planned-courses/${id}`, { status: value }); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  async function remove(id: string) {
    try { await del(`/api/planned-courses/${id}`, { confirm: true }); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  return (
    <div className="rounded-xl border border-[#EAF3FB] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-[#1F2D50]">{term.name}</h3>
        {status && <span className="rounded-full bg-[#EAF3FB] px-3 py-1 text-xs font-medium text-[#1F2D50]">{windowBadge(status.window)}</span>}
      </div>
      <p className="mb-2 text-xs text-[#5A6B8C]">{term.classes_start} → {term.classes_end}</p>
      {rows.length > 0 && (
        <ul className="mb-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-[#1F2D50]">
              <span className="font-medium">{r.course_code}</span>
              <span className="text-[#5A6B8C]">{r.course_title} ({r.credits} cr)</span>
              <label className="text-xs text-[#5A6B8C]">status
                <select aria-label={`status for ${r.course_code}`} value={r.status} onChange={(e) => setRegStatus(r.id, e.target.value)} className={inputCls + ' ml-1'}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button onClick={() => remove(r.id)} aria-label={`remove ${r.course_code}`} className="text-xs text-[#B3261E] underline">remove</button>
            </li>
          ))}
        </ul>
      )}
      {addable.length > 0 && (
        <form onSubmit={addPlanned} aria-label={`plan course for ${term.name}`} className="flex items-end gap-2">
          <label className="text-sm text-[#1F2D50]">Add course
            <select aria-label={`course to plan for ${term.name}`} name="course_id" required className={inputCls + ' mt-1 block'}>
              <option value="">— pick —</option>
              {addable.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-xl bg-[#1F2D50] px-3 py-2 text-sm font-medium text-white">Plan</button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-[#B3261E]">{error}</p>}
    </div>
  );
}

export function TermPlan({ programId, courses, terms, planned, onChanged }: { programId: string; courses: CourseRow[]; terms: TermRow[]; planned: PlannedJoined[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function addTerm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const opens = String(f.get('registration_opens_at') ?? '');
    try {
      await post('/api/terms', {
        name: String(f.get('name') ?? ''),
        classes_start: String(f.get('classes_start') ?? ''),
        classes_end: String(f.get('classes_end') ?? ''),
        registration_opens_at: opens ? new Date(opens).toISOString() : undefined,
      });
      form.reset();
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  return (
    <section aria-label="term plan" className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-[#1F2D50]">Term-by-term plan</h2>
      <form onSubmit={addTerm} aria-label="add term" className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-[#1F2D50]">Term name<input name="name" required placeholder="Fall 2026" className={inputCls + ' mt-1 block w-32'} /></label>
        <label className="text-sm text-[#1F2D50]">Classes start<input name="classes_start" required type="date" className={inputCls + ' mt-1 block'} /></label>
        <label className="text-sm text-[#1F2D50]">Classes end<input name="classes_end" required type="date" className={inputCls + ' mt-1 block'} /></label>
        <label className="text-sm text-[#1F2D50]">Registration opens<input name="registration_opens_at" type="datetime-local" className={inputCls + ' mt-1 block'} /></label>
        <button type="submit" className="rounded-xl bg-[#1F2D50] px-3 py-2 text-sm font-medium text-white">Add term</button>
      </form>
      {error && <p role="alert" className="text-sm text-[#B3261E]">{error}</p>}
      <div className="space-y-3">
        {terms.map((t) => <TermCard key={t.id} term={t} programId={programId} courses={courses} planned={planned} onChanged={onChanged} />)}
        {terms.length === 0 && <p className="text-sm text-[#5A6B8C]">No terms yet — add your next semester above.</p>}
      </div>
    </section>
  );
}

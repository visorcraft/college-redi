'use client';

import { useEffect, useState } from 'react';
import { api, del, patch, post, type CourseRow, type PlannedJoined, type RegistrationStatusResult, type TermRow } from './api';

const inputCls = 'rounded-lg border border-[#C9DAEC] bg-white p-2 text-sm text-[#1F2D50]';
const STATUSES = ['planned', 'registered', 'waitlisted', 'dropped', 'completed'] as const;

function windowBadge(w: RegistrationStatusResult['window']): string {
  if (w.state === 'not_scheduled') return 'window not scheduled';
  if (w.state === 'upcoming') return `registration opens in ${w.days_until_open}d`;
  if (w.state === 'open') return w.days_until_close !== null ? `registration open - closes in ${w.days_until_close}d` : 'registration open';
  return 'registration closed';
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function timestamp(form: FormData, name: string): string | null {
  const value = String(form.get(name) ?? '');
  return value ? new Date(value).toISOString() : null;
}

function termPayload(form: FormData) {
  const notes = String(form.get('notes') ?? '').trim();
  return {
    name: String(form.get('name') ?? ''),
    classes_start: String(form.get('classes_start') ?? ''),
    classes_end: String(form.get('classes_end') ?? ''),
    registration_opens_at: timestamp(form, 'registration_opens_at'),
    registration_closes_at: timestamp(form, 'registration_closes_at'),
    add_drop_deadline: timestamp(form, 'add_drop_deadline'),
    tuition_due: timestamp(form, 'tuition_due'),
    notes: notes || null,
  };
}

function TermFields({ term }: { term?: TermRow }) {
  return (
    <>
      <label className="text-sm text-[#1F2D50]">Term name<input name="name" required maxLength={60} defaultValue={term?.name} placeholder="Fall 2026" className={inputCls + ' mt-1 block w-32'} /></label>
      <label className="text-sm text-[#1F2D50]">Classes start<input name="classes_start" required type="date" defaultValue={term?.classes_start} className={inputCls + ' mt-1 block'} /></label>
      <label className="text-sm text-[#1F2D50]">Classes end<input name="classes_end" required type="date" defaultValue={term?.classes_end} className={inputCls + ' mt-1 block'} /></label>
      <label className="text-sm text-[#1F2D50]">Registration opens<input name="registration_opens_at" type="datetime-local" defaultValue={toDateTimeLocal(term?.registration_opens_at ?? null)} className={inputCls + ' mt-1 block'} /></label>
      <label className="text-sm text-[#1F2D50]">Registration closes<input name="registration_closes_at" type="datetime-local" defaultValue={toDateTimeLocal(term?.registration_closes_at ?? null)} className={inputCls + ' mt-1 block'} /></label>
      <label className="text-sm text-[#1F2D50]">Add/drop deadline<input name="add_drop_deadline" type="datetime-local" defaultValue={toDateTimeLocal(term?.add_drop_deadline ?? null)} className={inputCls + ' mt-1 block'} /></label>
      <label className="text-sm text-[#1F2D50]">Tuition due<input name="tuition_due" type="datetime-local" defaultValue={toDateTimeLocal(term?.tuition_due ?? null)} className={inputCls + ' mt-1 block'} /></label>
      <label className="text-sm text-[#1F2D50]">Notes<textarea name="notes" maxLength={500} defaultValue={term?.notes ?? ''} rows={2} className={inputCls + ' mt-1 block min-w-64'} /></label>
    </>
  );
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
  }, [term.id, term.registration_opens_at, term.registration_closes_at]);
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
      setError(null);
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  async function setRegStatus(id: string, value: string) {
    try { await patch(`/api/planned-courses/${id}`, { status: value }); setError(null); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  async function removePlanned(id: string) {
    try { await del(`/api/planned-courses/${id}`, { confirm: true }); setError(null); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  async function editTerm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await patch(`/api/terms/${term.id}`, termPayload(new FormData(e.currentTarget)));
      setError(null);
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  async function deleteTerm() {
    if (!window.confirm(`Delete ${term.name}?`)) return;
    try {
      await del(`/api/terms/${term.id}`, { confirm: true });
      setError(null);
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  return (
    <div className="rounded-xl border border-[#EAF3FB] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-[#1F2D50]">{term.name}</h3>
        {status && <span className="rounded-full bg-[#EAF3FB] px-3 py-1 text-xs font-medium text-[#1F2D50]">{windowBadge(status.window)}</span>}
      </div>
      <p className="mb-2 text-xs text-[#5A6B8C]">{term.classes_start} → {term.classes_end}</p>
      <dl className="mb-3 grid gap-x-4 gap-y-1 text-xs text-[#5A6B8C] sm:grid-cols-[auto_1fr]">
        <dt className="font-medium">Registration opens</dt><dd>{term.registration_opens_at ?? 'Not set'}</dd>
        <dt className="font-medium">Registration closes</dt><dd>{term.registration_closes_at ?? 'Not set'}</dd>
        <dt className="font-medium">Add/drop deadline</dt><dd>{term.add_drop_deadline ?? 'Not set'}</dd>
        <dt className="font-medium">Tuition due</dt><dd>{term.tuition_due ?? 'Not set'}</dd>
        <dt className="font-medium">Notes</dt><dd className="whitespace-pre-wrap">{term.notes ?? 'None'}</dd>
      </dl>
      <details className="mb-3 rounded-lg border border-[#EAF3FB] p-3">
        <summary className="cursor-pointer text-sm font-medium text-[#1F2D50]">Edit term</summary>
        <form onSubmit={editTerm} aria-label={`edit term ${term.name}`} className="mt-3 flex flex-wrap items-end gap-2">
          <TermFields term={term} />
          <button type="submit" className="rounded-xl bg-[#1F2D50] px-3 py-2 text-sm font-medium text-white">Save term</button>
          <button type="button" onClick={deleteTerm} className="rounded-xl border border-[#B3261E] px-3 py-2 text-sm font-medium text-[#B3261E]">Delete term</button>
        </form>
      </details>
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
              <button type="button" onClick={() => removePlanned(r.id)} aria-label={`remove ${r.course_code}`} className="text-xs text-[#B3261E] underline">remove</button>
            </li>
          ))}
        </ul>
      )}
      {addable.length > 0 && (
        <form onSubmit={addPlanned} aria-label={`plan course for ${term.name}`} className="flex items-end gap-2">
          <label className="text-sm text-[#1F2D50]">Add course
            <select aria-label={`course to plan for ${term.name}`} name="course_id" required className={inputCls + ' mt-1 block'}>
              <option value="">- pick -</option>
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
    try {
      await post('/api/terms', termPayload(f));
      form.reset();
      setError(null);
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  return (
    <section aria-label="term plan" className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-[#1F2D50]">Term-by-term plan</h2>
      <form onSubmit={addTerm} aria-label="add term" className="flex flex-wrap items-end gap-2">
        <TermFields />
        <button type="submit" className="rounded-xl bg-[#1F2D50] px-3 py-2 text-sm font-medium text-white">Add term</button>
      </form>
      {error && <p role="alert" className="text-sm text-[#B3261E]">{error}</p>}
      <div className="space-y-3">
        {terms.map((t) => <TermCard key={t.id} term={t} programId={programId} courses={courses} planned={planned} onChanged={onChanged} />)}
        {terms.length === 0 && <p className="text-sm text-[#5A6B8C]">No terms yet - add your next semester above.</p>}
      </div>
    </section>
  );
}

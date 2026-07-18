'use client';

import { useState } from 'react';
import { csrfHeaders, post } from './api';
import {
  DegreeImportDraftSchema,
  parseCourseNumberRanges,
  type BucketRule,
  type DegreeImportDraft,
} from '../../lib/schemas/degree';

const inputCls = 'rounded-lg border border-[#C9DAEC] bg-white p-2 text-sm text-[#1F2D50]';

type Phase =
  | { kind: 'input' }
  | { kind: 'parsing' }
  | { kind: 'confirming' }
  | { kind: 'review'; draft: DegreeImportDraft; error?: string }
  | { kind: 'done'; programId: string; draft: DegreeImportDraft; error?: string }
  | { kind: 'error'; message: string };

export function ImportFlow({ compact = false, onConfirmed }: {
  compact?: boolean;
  onConfirmed?: (programId: string, draft: DegreeImportDraft) => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [text, setText] = useState('');
  const [rangeInputs, setRangeInputs] = useState<Record<number, string>>({});

  async function parseText() {
    setPhase({ kind: 'parsing' });
    try {
      const result = await post<{ ok: boolean; draft?: DegreeImportDraft; error?: string }>('/api/programs/import', { text });
      if (!result.ok || !result.draft) setPhase({ kind: 'error', message: result.error ?? 'could not parse that audit' });
      else {
        setRangeInputs({});
        setPhase({ kind: 'review', draft: result.draft });
      }
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function parseFile(file: File) {
    setPhase({ kind: 'parsing' });
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/programs/import', {
        method: 'POST',
        body: form,
        headers: csrfHeaders(),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error?.message ?? `upload failed (${res.status})`);
      if (!result.ok || !result.draft) setPhase({ kind: 'error', message: result.error ?? 'could not parse that file' });
      else {
        setRangeInputs({});
        setPhase({ kind: 'review', draft: result.draft });
      }
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function finishConfirmation(programId: string, draft: DegreeImportDraft) {
    try {
      await onConfirmed?.(programId, draft);
      setPhase({ kind: 'done', programId, draft });
    } catch (err) {
      setPhase({
        kind: 'done',
        programId,
        draft,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function confirm(draft: DegreeImportDraft) {
    if (Object.values(rangeInputs).some((value) => parseCourseNumberRanges(value) === null)) {
      setPhase({
        kind: 'review',
        draft,
        error: 'Use course number ranges like 100-299, 400-499.',
      });
      return;
    }
    const checked = DegreeImportDraftSchema.safeParse(draft);
    if (!checked.success) {
      setPhase({
        kind: 'review',
        draft,
        error: checked.error.issues[0]?.message ?? 'Fix the highlighted import data.',
      });
      return;
    }
    setPhase({ kind: 'confirming' });
    try {
      const result = await post<{ program_id: string; warnings: string[] }>('/api/programs/import/confirm', { draft: checked.data });
      setPhase({ kind: 'done', programId: result.program_id, draft: checked.data });
      await finishConfirmation(result.program_id, checked.data);
    } catch (err) {
      setPhase({
        kind: 'review',
        draft,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (phase.kind === 'parsing') return <p className="text-[#1F2D50]">Redi is reading your audit… ☁️</p>;
  if (phase.kind === 'confirming') return <p className="text-[#1F2D50]">Saving your degree plan… ☁️</p>;
  if (phase.kind === 'done') return (
    <div className="space-y-2 rounded-xl bg-white p-4 text-[#1F2D50]">
      <p>Imported - your degree plan is ready 🎉</p>
      {phase.error && (
        <>
          <p role="alert" className="text-sm text-[#B3261E]">{phase.error}</p>
          <button
            onClick={() => finishConfirmation(phase.programId, phase.draft)}
            className="rounded-xl bg-[#1F2D50] px-4 py-2 text-sm font-medium text-white">
            Continue
          </button>
        </>
      )}
    </div>
  );
  if (phase.kind === 'review') {
    const { draft } = phase;
    const updateProgram = (patch: Partial<DegreeImportDraft['program']>) =>
      setPhase({ kind: 'review', draft: { ...draft, program: { ...draft.program, ...patch } } });
    const updateCourse = (index: number, patch: Partial<DegreeImportDraft['courses'][number]>) =>
      setPhase({ kind: 'review', draft: { ...draft, courses: draft.courses.map((item, i) => i === index ? { ...item, ...patch } : item) } });
    const updateRequirement = (index: number, patch: Partial<DegreeImportDraft['requirements'][number]>) =>
      setPhase({ kind: 'review', draft: { ...draft, requirements: draft.requirements.map((item, i) => i === index ? { ...item, ...patch } : item) } });
    const updateBucket = (index: number, rule: BucketRule) =>
      updateRequirement(index, { bucket_rule: rule });
    const updateCompleted = (index: number, patch: Partial<DegreeImportDraft['completed_courses'][number]>) =>
      setPhase({ kind: 'review', draft: { ...draft, completed_courses: draft.completed_courses.map((item, i) => i === index ? { ...item, ...patch } : item) } });
    const drop = <K extends 'requirements' | 'courses' | 'completed_courses'>(key: K, index: number) => {
      if (key === 'requirements') {
        setRangeInputs((current) => Object.fromEntries(
          Object.entries(current)
            .filter(([stored]) => Number(stored) !== index)
            .map(([stored, value]) => [
              Number(stored) > index ? Number(stored) - 1 : Number(stored),
              value,
            ]),
        ));
      }
      setPhase({ kind: 'review', draft: { ...draft, [key]: draft[key].filter((_, i) => i !== index) } });
    };
    return (
      <section aria-label="review import" className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        {!compact && <h2 className="text-lg font-semibold text-[#1F2D50]">Review what Redi found</h2>}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm text-[#1F2D50]">Program name
            <input value={draft.program.name} onChange={(e) => updateProgram({ name: e.target.value })} className={inputCls + ' mt-1 w-full'} />
          </label>
          <label className="text-sm text-[#1F2D50]">Institution
            <input value={draft.program.institution} onChange={(e) => updateProgram({ institution: e.target.value })} className={inputCls + ' mt-1 w-full'} />
          </label>
          <label className="text-sm text-[#1F2D50]">Catalog year
            <input value={draft.program.catalog_year ?? ''} onChange={(e) => updateProgram({ catalog_year: e.target.value })} className={inputCls + ' mt-1 w-full'} />
          </label>
          <label className="text-sm text-[#1F2D50]">Total credits
            <input type="number" min={1} value={draft.program.total_credits_required} onChange={(e) => updateProgram({ total_credits_required: Number(e.target.value) })} className={inputCls + ' mt-1 w-full'} />
          </label>
          <label className="text-sm text-[#1F2D50]">Minimum GPA
            <input type="number" min={0} max={5} step="0.1" value={draft.program.gpa_requirement ?? ''} onChange={(e) => updateProgram({ gpa_requirement: e.target.value ? Number(e.target.value) : undefined })} className={inputCls + ' mt-1 w-full'} />
          </label>
        </div>
        {draft.confidence_flags.length > 0 && (
          <div role="alert" className="rounded-xl bg-[#FFF4D6] p-3 text-sm text-[#1F2D50]">
            <p className="font-medium">Worth a look ⛅</p>
            <ul className="list-inside list-disc">{draft.confidence_flags.map((f, i) => <li key={i}>{f.message}</li>)}</ul>
          </div>
        )}
        {phase.error && <p role="alert" className="text-sm text-[#B3261E]">{phase.error}</p>}
        <div>
          <h3 className="font-medium text-[#1F2D50]">Courses ({draft.courses.length})</h3>
          <ul className="space-y-2 text-sm text-[#1F2D50]">
            {draft.courses.map((c, i) => (
              <li key={i} className="grid gap-2 rounded-xl border border-[#EAF3FB] p-3 sm:grid-cols-[8rem_1fr_6rem_auto]">
                <label>Code<input aria-label={`Course code ${i + 1}`} value={c.code} onChange={(e) => updateCourse(i, { code: e.target.value })} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Title<input aria-label={`Course title ${c.code}`} value={c.title} onChange={(e) => updateCourse(i, { title: e.target.value })} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Credits<input aria-label={`Course credits ${c.code}`} type="number" min={0} value={c.credits} onChange={(e) => updateCourse(i, { credits: Number(e.target.value) })} className={inputCls + ' mt-1 w-full'} /></label>
                <button aria-label={`drop course ${c.code}`} onClick={() => drop('courses', i)} className="text-xs text-[#B3261E] underline">remove</button>
                <label className="sm:col-span-full">Description
                  <textarea aria-label={`Course description ${i + 1}`} value={c.description ?? ''} onChange={(e) => updateCourse(i, { description: e.target.value || undefined })} rows={2} className={inputCls + ' mt-1 w-full'} />
                </label>
                <label className="sm:col-span-2">Prerequisites, comma separated
                  <input aria-label={`Course prerequisites ${i + 1}`} value={c.prerequisites?.join(', ') ?? ''} onChange={(e) => updateCourse(i, { prerequisites: e.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="CS 101, MATH 151" className={inputCls + ' mt-1 w-full'} />
                </label>
                <label className="sm:col-span-2">Typical terms, comma separated
                  <input aria-label={`Course typical terms ${i + 1}`} value={c.typical_terms?.join(', ') ?? ''} onChange={(e) => updateCourse(i, { typical_terms: e.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="Fall, Spring" className={inputCls + ' mt-1 w-full'} />
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-medium text-[#1F2D50]">Requirements ({draft.requirements.length})</h3>
          <ul className="space-y-2 text-sm text-[#1F2D50]">
            {draft.requirements.map((r, i) => (
              <li key={i} className="grid gap-2 rounded-xl border border-[#EAF3FB] p-3 sm:grid-cols-2">
                <label>Group<input aria-label={`Requirement group ${i + 1}`} value={r.group_name} onChange={(e) => updateRequirement(i, { group_name: e.target.value })} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Type
                  <select
                    aria-label={`Requirement type ${i + 1}`}
                    value={r.type}
                    onChange={(e) => {
                      const type = e.target.value as typeof r.type;
                      if (type !== 'credit_bucket') {
                        setRangeInputs((current) => {
                          const next = { ...current };
                          delete next[i];
                          return next;
                        });
                      }
                      updateRequirement(i, type === 'credit_bucket'
                        ? {
                            type,
                            credits_required: r.credits_required ?? 1,
                            bucket_rule: r.bucket_rule ?? { subjects: [] },
                          }
                        : type === 'course'
                          ? {
                              type,
                              course_code: r.course_code ?? draft.courses[0]?.code,
                            }
                          : { type });
                    }}
                    className={inputCls + ' mt-1 w-full'}>
                    <option value="course">course</option>
                    <option value="credit_bucket">credit bucket</option>
                    <option value="gpa">GPA</option>
                    <option value="milestone">milestone</option>
                  </select>
                </label>
                {r.type === 'course' && <label>Course code<input aria-label={`Requirement course ${i + 1}`} value={r.course_code ?? ''} onChange={(e) => updateRequirement(i, { course_code: e.target.value || undefined })} className={inputCls + ' mt-1 w-full'} /></label>}
                {r.type === 'credit_bucket' && (
                  <>
                    <label>Credits required<input aria-label={`Requirement credits ${i + 1}`} type="number" min={1} value={r.credits_required ?? 1} onChange={(e) => updateRequirement(i, { credits_required: Number(e.target.value) })} className={inputCls + ' mt-1 w-full'} /></label>
                    <label>Subjects, comma separated<input aria-label={`Requirement subjects ${i + 1}`} value={r.bucket_rule?.subjects?.join(', ') ?? ''} onChange={(e) => updateBucket(i, { ...r.bucket_rule, subjects: e.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="HUM, PHIL" className={inputCls + ' mt-1 w-full'} /></label>
                    <label>Course codes, comma separated<input aria-label={`Requirement course codes ${i + 1}`} value={r.bucket_rule?.course_codes?.join(', ') ?? ''} onChange={(e) => updateBucket(i, { ...r.bucket_rule, course_codes: e.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="CS 301, CS 302" className={inputCls + ' mt-1 w-full'} /></label>
                    <label>Course number ranges
                      <input
                        aria-label={`Requirement number ranges ${i + 1}`}
                        value={rangeInputs[i] ?? r.bucket_rule?.number_ranges?.map((range) => `${range.min}-${range.max}`).join(', ') ?? ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setRangeInputs((current) => ({ ...current, [i]: value }));
                          const numberRanges = parseCourseNumberRanges(value);
                          if (numberRanges !== null) {
                            updateBucket(i, { ...r.bucket_rule, number_ranges: numberRanges });
                          }
                        }}
                        onBlur={(e) => {
                          const numberRanges = parseCourseNumberRanges(e.target.value);
                          if (numberRanges === null) {
                            setPhase({ kind: 'review', draft, error: 'Use course number ranges like 100-299, 400-499.' });
                          }
                        }}
                        placeholder="100-299, 400-499"
                        className={inputCls + ' mt-1 w-full'}
                      />
                    </label>
                  </>
                )}
                <label>Minimum grade<input aria-label={`Requirement minimum grade ${i + 1}`} value={r.min_grade ?? ''} onChange={(e) => updateRequirement(i, { min_grade: e.target.value || undefined })} placeholder="C" className={inputCls + ' mt-1 w-full'} /></label>
                <label>Sort order<input aria-label={`Requirement sort order ${i + 1}`} type="number" min={0} value={r.sort_order ?? ''} onChange={(e) => updateRequirement(i, { sort_order: e.target.value ? Number(e.target.value) : undefined })} className={inputCls + ' mt-1 w-full'} /></label>
                <label>Description<input aria-label={`Requirement description ${i + 1}`} value={r.description ?? ''} onChange={(e) => updateRequirement(i, { description: e.target.value })} className={inputCls + ' mt-1 w-full'} /></label>
                <button aria-label={`drop requirement ${i + 1}`} onClick={() => drop('requirements', i)} className="text-xs text-[#B3261E] underline">remove</button>
              </li>
            ))}
          </ul>
        </div>
        {draft.completed_courses.length > 0 && (
          <div>
            <h3 className="font-medium text-[#1F2D50]">Completed / in-progress ({draft.completed_courses.length})</h3>
            <ul className="space-y-2 text-sm text-[#1F2D50]">
              {draft.completed_courses.map((c, i) => (
                <li key={i} className="grid gap-2 rounded-xl border border-[#EAF3FB] p-3 sm:grid-cols-3">
                  <label>Course code<input aria-label={`Completed course code ${i + 1}`} value={c.course_code} onChange={(e) => updateCompleted(i, { course_code: e.target.value })} className={inputCls + ' mt-1 w-full'} /></label>
                  <label>Term<input aria-label={`Completed term ${i + 1}`} value={c.term} onChange={(e) => updateCompleted(i, { term: e.target.value })} className={inputCls + ' mt-1 w-full'} /></label>
                  <label>Year<input aria-label={`Completed year ${i + 1}`} type="number" min={1900} max={2200} value={c.year} onChange={(e) => updateCompleted(i, { year: Number(e.target.value) })} className={inputCls + ' mt-1 w-full'} /></label>
                  <label>Grade<input aria-label={`Completed grade ${i + 1}`} value={c.grade ?? ''} onChange={(e) => updateCompleted(i, { grade: e.target.value || undefined })} className={inputCls + ' mt-1 w-full'} /></label>
                  <label>Credits<input aria-label={`Completed credits ${i + 1}`} type="number" min={0} value={c.credits} onChange={(e) => updateCompleted(i, { credits: Number(e.target.value) })} className={inputCls + ' mt-1 w-full'} /></label>
                  <label>Status
                    <select aria-label={`Completed status ${i + 1}`} value={c.status} onChange={(e) => updateCompleted(i, { status: e.target.value as typeof c.status })} className={inputCls + ' mt-1 w-full'}>
                      <option value="completed">completed</option>
                      <option value="in_progress">in progress</option>
                      <option value="transfer">transfer</option>
                    </select>
                  </label>
                  <button aria-label={`drop completed ${c.course_code}`} onClick={() => drop('completed_courses', i)} className="text-xs text-[#B3261E] underline">remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={() => confirm(draft)} className="rounded-xl bg-[#1F2D50] px-4 py-2 font-medium text-white">Looks right - import</button>
          <button onClick={() => { setRangeInputs({}); setPhase({ kind: 'input' }); }} className="rounded-xl bg-[#EAF3FB] px-4 py-2 font-medium text-[#1F2D50]">Start over</button>
        </div>
      </section>
    );
  }
  return (
    <section aria-label="import degree audit" className="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
      {!compact && <h2 className="text-lg font-semibold text-[#1F2D50]">Import your degree audit</h2>}
      <label className="block text-sm text-[#1F2D50]">Paste audit text
        <textarea aria-label="audit text" value={text} onChange={(e) => setText(e.target.value)} rows={8}
          className={inputCls + ' mt-1 w-full'} placeholder="Paste your degree audit or catalog page here…" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={parseText} disabled={!text.trim()} className="rounded-xl bg-[#1F2D50] px-4 py-2 font-medium text-white disabled:opacity-40">Parse with Redi</button>
        <label className="text-sm text-[#1F2D50]">or upload PDF/TXT
          <input aria-label="audit file" type="file" accept=".pdf,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }} className="ml-2 text-sm" />
        </label>
      </div>
      {phase.kind === 'error' && <p role="alert" className="text-sm text-[#B3261E]">{phase.message}</p>}
    </section>
  );
}

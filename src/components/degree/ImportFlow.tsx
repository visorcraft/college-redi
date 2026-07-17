'use client';

import { useState } from 'react';
import { csrfHeaders, post } from './api';
import type { DegreeImportDraft } from '../../lib/schemas/degree';

const inputCls = 'rounded-lg border border-[#C9DAEC] bg-white p-2 text-sm text-[#1F2D50]';

type Phase = { kind: 'input' } | { kind: 'parsing' } | { kind: 'review'; draft: DegreeImportDraft } | { kind: 'done'; programId: string } | { kind: 'error'; message: string };

export function ImportFlow({ compact = false, onConfirmed }: { compact?: boolean; onConfirmed?: (programId: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [text, setText] = useState('');

  async function parseText() {
    setPhase({ kind: 'parsing' });
    try {
      const result = await post<{ ok: boolean; draft?: DegreeImportDraft; error?: string }>('/api/programs/import', { text });
      if (!result.ok || !result.draft) setPhase({ kind: 'error', message: result.error ?? 'could not parse that audit' });
      else setPhase({ kind: 'review', draft: result.draft });
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
      else setPhase({ kind: 'review', draft: result.draft });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function confirm(draft: DegreeImportDraft) {
    try {
      const result = await post<{ program_id: string; warnings: string[] }>('/api/programs/import/confirm', { draft });
      setPhase({ kind: 'done', programId: result.program_id });
      onConfirmed?.(result.program_id);
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (phase.kind === 'parsing') return <p className="text-[#1F2D50]">Redi is reading your audit… ☁️</p>;
  if (phase.kind === 'done') return <p className="rounded-xl bg-white p-4 text-[#1F2D50]">Imported — your degree plan is ready 🎉</p>;
  if (phase.kind === 'review') {
    const { draft } = phase;
    const drop = <K extends 'requirements' | 'courses' | 'completed_courses'>(key: K, index: number) =>
      setPhase({ kind: 'review', draft: { ...draft, [key]: draft[key].filter((_, i) => i !== index) } });
    return (
      <section aria-label="review import" className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        {!compact && <h2 className="text-lg font-semibold text-[#1F2D50]">Review what Redi found</h2>}
        <p className="text-sm text-[#1F2D50]">
          <strong>{draft.program.name}</strong>, {draft.program.institution} — {draft.program.total_credits_required} credits
          {draft.program.gpa_requirement ? `, min GPA ${draft.program.gpa_requirement}` : ''}
        </p>
        {draft.confidence_flags.length > 0 && (
          <div role="alert" className="rounded-xl bg-[#FFF4D6] p-3 text-sm text-[#1F2D50]">
            <p className="font-medium">Worth a look ⛅</p>
            <ul className="list-inside list-disc">{draft.confidence_flags.map((f, i) => <li key={i}>{f.message}</li>)}</ul>
          </div>
        )}
        <div>
          <h3 className="font-medium text-[#1F2D50]">Courses ({draft.courses.length})</h3>
          <ul className="text-sm text-[#1F2D50]">
            {draft.courses.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                {c.code} — {c.title} ({c.credits} cr)
                <button aria-label={`drop course ${c.code}`} onClick={() => drop('courses', i)} className="text-xs text-[#B3261E] underline">remove</button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-medium text-[#1F2D50]">Requirements ({draft.requirements.length})</h3>
          <ul className="text-sm text-[#1F2D50]">
            {draft.requirements.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                [{r.group_name}] {r.type}{r.course_code ? `: ${r.course_code}` : ''}{r.credits_required ? ` — ${r.credits_required} credits` : ''}
                <button aria-label={`drop requirement ${i + 1}`} onClick={() => drop('requirements', i)} className="text-xs text-[#B3261E] underline">remove</button>
              </li>
            ))}
          </ul>
        </div>
        {draft.completed_courses.length > 0 && (
          <div>
            <h3 className="font-medium text-[#1F2D50]">Completed / in-progress ({draft.completed_courses.length})</h3>
            <ul className="text-sm text-[#1F2D50]">
              {draft.completed_courses.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  {c.course_code} — {c.term} {c.year}{c.grade ? `, ${c.grade}` : ''} ({c.status})
                  <button aria-label={`drop completed ${c.course_code}`} onClick={() => drop('completed_courses', i)} className="text-xs text-[#B3261E] underline">remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={() => confirm(draft)} className="rounded-xl bg-[#1F2D50] px-4 py-2 font-medium text-white">Looks right — import</button>
          <button onClick={() => setPhase({ kind: 'input' })} className="rounded-xl bg-[#EAF3FB] px-4 py-2 font-medium text-[#1F2D50]">Start over</button>
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

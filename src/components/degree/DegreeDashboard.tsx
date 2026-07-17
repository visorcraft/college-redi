'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api, type CourseRow, type DegreeProgress, type PlannedJoined, type ProgramRow,
  type RequirementRow, type TermRow,
} from './api';
import { ManualBuilder, ProgramForm } from './ManualBuilder';
import { TermPlan } from './TermPlan';
import { ImportFlow } from './ImportFlow';

export function ProgressRing({ progress }: { progress: DegreeProgress }) {
  const pct = progress.percent_complete;
  const r = 52;
  const circ = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-6 rounded-2xl bg-white p-6 shadow-sm">
      <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label={`degree ${pct}% complete`}>
        <circle cx="64" cy="64" r={r} fill="none" stroke="#EAF3FB" strokeWidth="12" />
        <circle cx="64" cy="64" r={r} fill="none" stroke="#1F2D50" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} transform="rotate(-90 64 64)" />
        <text x="64" y="69" textAnchor="middle" fontSize="22" fontWeight="700" fill="#1F2D50">{pct}%</text>
      </svg>
      <div className="text-[#1F2D50]">
        <p className="text-lg font-semibold">{progress.credits_completed} / {progress.total_credits_required} credits</p>
        {progress.credits_in_progress > 0 && <p className="text-sm">{progress.credits_in_progress} in progress</p>}
        {progress.credits_planned > 0 && <p className="text-sm">{progress.credits_planned} planned</p>}
        {progress.gpa !== null && <p className="text-sm">GPA {progress.gpa}{progress.gpa_requirement !== null ? ` (requires ${progress.gpa_requirement})` : ''}</p>}
        <p className="text-sm font-medium">
          {progress.requirements_met
            ? (progress.projected_graduation_term ? `On pace to finish: ${progress.projected_graduation_term}` : 'Requirements met 🎉')
            : (progress.projected_graduation_term ? `Projected graduation: ${progress.projected_graduation_term}` : 'No complete plan yet')}
        </p>
      </div>
    </div>
  );
}

export function RequirementGroups({ requirements, progress }: { requirements: RequirementRow[]; progress: DegreeProgress }) {
  const byReq = new Map(progress.requirements.map((r) => [r.requirement_id, r]));
  const groups = new Map<string, RequirementRow[]>();
  for (const r of requirements) {
    const list = groups.get(r.group_name) ?? [];
    list.push(r);
    groups.set(r.group_name, list);
  }
  return (
    <section aria-label="requirements" className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-[#1F2D50]">Requirements</h2>
      {[...groups.entries()].map(([group, reqs]) => (
        <div key={group} className="mb-4">
          <h3 className="mb-1 font-medium text-[#1F2D50]">{group}</h3>
          <ul className="space-y-1">
            {reqs.map((r) => {
              const p = byReq.get(r.id);
              return (
                <li key={r.id} className="text-sm text-[#1F2D50]">
                  <span aria-hidden>{p?.satisfied ? '✅' : p?.in_progress ? '🌤️' : '⬜'}</span>{' '}
                  {r.type === 'course' && <span>{p?.satisfied_by[0]?.course_code ?? 'Required course'}{r.min_grade ? ` (min grade ${r.min_grade})` : ''}</span>}
                  {r.type === 'credit_bucket' && <span>{p?.credits_satisfied ?? 0} / {r.credits_required} credits</span>}
                  {r.type === 'gpa' && <span>GPA requirement{p?.satisfied ? ' met' : ''}</span>}
                  {r.type === 'milestone' && <span>{r.description || 'Milestone'} (tracked manually)</span>}
                  {r.description && r.type !== 'milestone' && <span className="text-[#5A6B8C]"> — {r.description}</span>}
                  {p && p.satisfied_by.length > 0 && (
                    <details className="ml-6 text-xs text-[#5A6B8C]">
                      <summary>satisfied by</summary>
                      <ul>{p.satisfied_by.map((s, i) => (
                        <li key={i}>{s.course_code} — {s.term} {s.year}{s.grade ? `, ${s.grade}` : ''} ({s.credits} cr{s.status !== 'completed' ? `, ${s.status}` : ''})</li>
                      ))}</ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

export default function DegreeDashboard() {
  const [programs, setPrograms] = useState<ProgramRow[] | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [progress, setProgress] = useState<DegreeProgress | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [requirements, setRequirements] = useState<RequirementRow[]>([]);
  const [terms, setTerms] = useState<TermRow[]>([]);
  const [planned, setPlanned] = useState<PlannedJoined[]>([]);
  const [startMode, setStartMode] = useState<'none' | 'manual' | 'import'>('none');
  const [error, setError] = useState<string | null>(null);

  const loadPrograms = useCallback(async () => {
    const list = await api<ProgramRow[]>('/api/programs');
    setPrograms(list);
    setProgramId((cur) => cur ?? list[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (pid: string) => {
    const [p, c, r, t, pl] = await Promise.all([
      api<DegreeProgress>(`/api/progress?program_id=${pid}`),
      api<CourseRow[]>(`/api/courses?program_id=${pid}`),
      api<RequirementRow[]>(`/api/requirements?program_id=${pid}`),
      api<TermRow[]>('/api/terms'),
      api<PlannedJoined[]>(`/api/planned-courses?program_id=${pid}`),
    ]);
    setProgress(p); setCourses(c); setRequirements(r); setTerms(t); setPlanned(pl);
  }, []);

  const run = useCallback((fn: () => Promise<void>) => fn().catch((e) => setError(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { run(async () => loadPrograms()); }, [loadPrograms, run]);
  useEffect(() => { if (programId) run(async () => loadDetail(programId)); }, [programId, loadDetail, run]);
  const refresh = useCallback(() => run(async () => { await loadPrograms(); if (programId) await loadDetail(programId); }), [loadPrograms, loadDetail, programId, run]);

  if (error) return <p role="alert" className="rounded-xl bg-white p-4 text-[#B3261E]">{error}</p>;
  if (programs === null) return <p className="text-[#1F2D50]">Loading your degree…</p>;

  if (programs.length === 0 && startMode === 'none') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <p className="text-[#1F2D50]">No degree program yet. Redi can parse your degree audit, or you can build it by hand.</p>
        <div className="flex gap-3">
          <button onClick={() => setStartMode('import')} className="rounded-xl bg-[#1F2D50] px-4 py-2 font-medium text-white">Import with Redi ☁️</button>
          <button onClick={() => setStartMode('manual')} className="rounded-xl bg-white px-4 py-2 font-medium text-[#1F2D50] shadow-sm">Add program manually</button>
        </div>
      </div>
    );
  }
  if (startMode === 'import') {
    return <ImportFlow onConfirmed={() => { setStartMode('none'); refresh(); }} />;
  }
  if (programs.length === 0 && startMode === 'manual') {
    return <ProgramForm onCreated={() => { setStartMode('none'); refresh(); }} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[#1F2D50]">
          Program{' '}
          <select aria-label="program" value={programId ?? ''} onChange={(e) => setProgramId(e.target.value)} className="rounded-lg border border-[#C9DAEC] bg-white p-2">
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button onClick={() => setStartMode('import')} className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-[#1F2D50] shadow-sm">Import another audit</button>
      </div>
      {progress && <ProgressRing progress={progress} />}
      {progress && progress.risk_flags.length > 0 && (
        <div role="alert" className="rounded-2xl bg-[#FFF4D6] p-4 text-sm text-[#1F2D50]">
          <p className="mb-1 font-semibold">Heads up ⛅</p>
          <ul className="list-inside list-disc">{progress.risk_flags.map((f, i) => <li key={i}>{f.message}</li>)}</ul>
        </div>
      )}
      {progress && <RequirementGroups requirements={requirements} progress={progress} />}
      {programId && <ManualBuilder programId={programId} courses={courses} onChanged={refresh} />}
      {programId && <TermPlan programId={programId} courses={courses} terms={terms} planned={planned} onChanged={refresh} />}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { post, type BucketRule, type CourseRow } from './api';

const inputCls = 'rounded-lg border border-[#C9DAEC] bg-white p-2 text-sm text-[#1F2D50]';

export function ProgramForm({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await post('/api/programs', {
        name: String(f.get('name') ?? ''),
        institution: String(f.get('institution') ?? ''),
        catalog_year: String(f.get('catalog_year') ?? '') || undefined,
        total_credits_required: Number(f.get('total_credits_required') ?? 0),
        gpa_requirement: f.get('gpa_requirement') ? Number(f.get('gpa_requirement')) : undefined,
      });
      onCreated();
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

function parseRanges(text: string): Array<{ min: number; max: number }> {
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [min, max] = s.split('-').map((n) => Number(n.trim()));
    return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 9999 };
  });
}
const csv = (text: string): string[] => text.split(',').map((s) => s.trim()).filter(Boolean);

export function ManualBuilder({ programId, courses, onChanged }: { programId: string; courses: CourseRow[]; onChanged: () => void }) {
  const [reqType, setReqType] = useState('course');
  const [error, setError] = useState<string | null>(null);

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
        prerequisites: csv(String(f.get('prerequisites') ?? '')),
      });
      form.reset();
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function addRequirement(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const bucket_rule: BucketRule = {};
    const subjects = csv(String(f.get('bucket_subjects') ?? ''));
    const ranges = parseRanges(String(f.get('bucket_ranges') ?? ''));
    const codes = csv(String(f.get('bucket_codes') ?? ''));
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
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  return (
    <section aria-label="edit program" className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-[#1F2D50]">Build your program</h2>
      <form onSubmit={addCourse} aria-label="add course" className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-[#1F2D50]">Course code<input name="code" required placeholder="CS 101" className={inputCls + ' mt-1 block w-28'} /></label>
        <label className="text-sm text-[#1F2D50]">Title<input name="title" required placeholder="Intro to CS" className={inputCls + ' mt-1 block w-48'} /></label>
        <label className="text-sm text-[#1F2D50]">Credits<input name="credits" required type="number" min={0} className={inputCls + ' mt-1 block w-20'} /></label>
        <label className="text-sm text-[#1F2D50]">Prerequisites (comma-separated)<input name="prerequisites" placeholder="MATH 151" className={inputCls + ' mt-1 block w-40'} /></label>
        <button type="submit" className="rounded-xl bg-[#1F2D50] px-3 py-2 text-sm font-medium text-white">Add course</button>
      </form>
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
        <button type="submit" className="rounded-xl bg-[#1F2D50] px-3 py-2 text-sm font-medium text-white">Add requirement</button>
      </form>
      {error && <p role="alert" className="text-sm text-[#B3261E]">{error}</p>}
    </section>
  );
}

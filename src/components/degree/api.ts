'use client';

import { csrfHeaders } from '@/lib/api';
export { csrfHeaders } from '@/lib/api';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? csrfHeaders() : {}),
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: { message?: string } })?.error?.message ?? `request failed (${res.status})`);
  return body as T;
}
export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) });

export interface ProgramRow { id: string; name: string; institution: string; catalog_year: string | null; total_credits_required: number; gpa_requirement: number | null; status: string; source: string }
export interface CourseRow { id: string; program_id: string; code: string; title: string; credits: number; description: string | null; prerequisites: string[]; typical_terms: string[]; subject: string }
export interface BucketRule { subjects?: string[]; number_ranges?: Array<{ min: number; max: number }>; course_codes?: string[] }
export interface RequirementRow { id: string; program_id: string; type: string; course_id: string | null; credits_required: number | null; min_grade: string | null; bucket_rule: BucketRule | null; group_name: string; description: string; sort_order: number }
export interface CompletedCourseRow { id: string; program_id: string; course_id: string; term: string; year: number; grade: string | null; credits: number; status: 'completed' | 'in_progress' | 'transfer'; source: string; created_at: string; course_code: string; course_title: string }
export interface TermRow { id: string; name: string; classes_start: string; classes_end: string; registration_opens_at: string | null; registration_closes_at: string | null; add_drop_deadline: string | null; tuition_due: string | null; notes: string | null }
export interface PlannedJoined { id: string; program_id: string; course_id: string; term_id: string; status: string; section: string | null; notes: string | null; course_code: string; course_title: string; credits: number; term_name: string; classes_start: string }
export interface SatisfiedByEntry { course_code: string; term: string; year: number; grade: string | null; credits: number; status: string }
export interface RequirementProgress { requirement_id: string; type: string; group_name: string; description: string; credits_required: number | null; credits_satisfied: number; satisfied: boolean; in_progress: boolean; untracked: boolean; satisfied_by: SatisfiedByEntry[] }
export interface RiskFlag { type: string; message: string; course_code?: string; term?: string }
export interface DegreeProgress { program_id: string; program_name: string; total_credits_required: number; credits_completed: number; credits_in_progress: number; credits_planned: number; percent_complete: number; gpa: number | null; gpa_requirement: number | null; requirements: RequirementProgress[]; requirements_met: boolean; projected_graduation_term: string | null; status: 'on_track' | 'at_risk'; risk_flags: RiskFlag[] }
export interface RegistrationWindow { state: 'not_scheduled' | 'upcoming' | 'open' | 'closed'; opens_at: string | null; closes_at: string | null; days_until_open: number | null; days_until_close: number | null }
export interface RegistrationStatusResult { term: TermRow | null; window: RegistrationWindow; planned_courses: Array<{ id: string; course_code: string; title: string; credits: number; status: string; section: string | null; notes: string | null }>; unregistered_count: number }

import Link from 'next/link';
import { ProgressRing } from '@/components/degree/DegreeDashboard';
import type { DegreeProgress, RegistrationStatusResult } from '@/components/degree/api';
import { callTool } from '@/server/tools/call';

const CTX = { actor: 'user' };

function registrationWindow(
  window: RegistrationStatusResult['window'],
): string {
  if (window.state === 'not_scheduled') return 'Registration dates not set';
  if (window.state === 'upcoming') {
    return `Opens in ${window.days_until_open ?? 0} day${window.days_until_open === 1 ? '' : 's'}`;
  }
  if (window.state === 'open') {
    return window.days_until_close === null
      ? 'Open now'
      : `Open now, closes in ${window.days_until_close} day${window.days_until_close === 1 ? '' : 's'}`;
  }
  return 'Registration closed';
}

export async function DashboardRegistrationCard() {
  let status: RegistrationStatusResult | null = null;
  try {
    status = await callTool('get_registration_status', {}, CTX) as RegistrationStatusResult;
  } catch {
    // New accounts may not have a term yet.
  }
  return (
    <section aria-label="Registration term" className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[#1F2D50]">
          {status?.term ? `${status.term.name} registration` : 'Registration'}
        </h2>
        {status && (
          <span className="rounded-full bg-[#EAF3FB] px-3 py-1 text-xs font-medium text-[#1F2D50]">
            {registrationWindow(status.window)}
          </span>
        )}
      </div>
      {!status?.term ? (
        <p className="mt-2 text-sm text-[#1F2D50]/70">
          Add your next term to track its registration window.
        </p>
      ) : status.planned_courses.length === 0 ? (
        <p className="mt-2 text-sm text-[#1F2D50]/70">No courses planned for this term.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[#1F2D50]/70">
            {status.unregistered_count} course{status.unregistered_count === 1 ? '' : 's'} still need registration
          </p>
          <ul className="mt-2 space-y-1">
            {status.planned_courses.map((course) => (
              <li key={course.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 font-medium text-[#1F2D50]">
                  {course.course_code} · {course.title}
                </span>
                <span className="shrink-0 capitalize text-[#1F2D50]/70">{course.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link href="/degree" className="mt-3 inline-block text-sm font-medium underline">
        Open term plan
      </Link>
    </section>
  );
}

export async function DashboardDegreeProgress() {
  try {
    const progress = await callTool('get_degree_progress', {}, CTX) as DegreeProgress;
    return (
      <section aria-label="Degree progress">
        <h2 className="sr-only">Degree progress</h2>
        <ProgressRing progress={progress} />
      </section>
    );
  } catch {
    return (
      <section aria-label="Degree progress" className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-[#1F2D50]">Degree progress</h2>
        <p className="mt-2 text-sm text-[#1F2D50]/70">
          Add your degree plan to see credits and projected graduation here.
        </p>
        <Link href="/degree" className="mt-3 inline-block text-sm font-medium underline">
          Set up My Degree
        </Link>
      </section>
    );
  }
}

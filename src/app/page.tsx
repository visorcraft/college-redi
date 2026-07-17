import { redirect } from 'next/navigation';
import { getSecret } from '@/server/secrets';
import { getSettings } from '@/server/settings';
import SetupBanners from '@/components/dashboard/SetupBanners';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // First-run contract: no password yet, or wizard unfinished → /wizard (spec §5).
  const passwordSet = (await getSecret('login.password_hash')) !== null;
  const settings = await getSettings();
  if (!passwordSet || !settings.wizard_state.completed) redirect('/wizard');

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <SetupBanners />
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1F2D50]">Today</h1>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-xl border border-[#1F2D50]/30 px-4 py-2 text-sm font-medium text-[#1F2D50] hover:bg-white"
          >
            Sign out
          </button>
        </form>
      </header>
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-[#1F2D50]/80">
          Redi is settling in. The dashboard comes alive as degree plans, tasks, and notifications arrive in the next
          milestones.
        </p>
      </section>
    </main>
  );
}

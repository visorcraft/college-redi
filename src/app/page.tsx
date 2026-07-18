import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { readSessionToken, SESSION_COOKIE } from '@/server/auth';
import { getSecret } from '@/server/secrets';
import { getSettings } from '@/server/settings';
import SetupBanners from '@/components/dashboard/SetupBanners';
import { TodayCard } from '@/components/ui/TodayCard';
import CollegeInboxCard from '@/components/email/CollegeInboxCard';
import RediOneLiner from '@/components/redi/RediOneLiner';
import {
  DashboardDegreeProgress,
  DashboardRegistrationCard,
} from '@/components/dashboard/DashboardDegreeCards';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // First-run contract: no password yet, or wizard unfinished → /wizard (spec §5).
  const passwordSet = (await getSecret('login.password_hash')) !== null;
  if (!passwordSet) redirect('/wizard');
  const cookieStore = await cookies();
  if (!(await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value)).valid) {
    redirect('/login');
  }
  const settings = await getSettings();
  if (!settings.wizard_state.completed) redirect('/wizard');

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold text-[#1F2D50]">Today</h1>
      <RediOneLiner />
      <div className="space-y-4" aria-label="Today overview">
        <TodayCard />
        <DashboardRegistrationCard />
      </div>
      <DashboardDegreeProgress />
      <CollegeInboxCard />
      <SetupBanners />
    </main>
  );
}

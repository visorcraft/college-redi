import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import './globals.css';
import { RediWidget } from '@/components/redi/RediWidget';
import { getSettings } from '@/server/settings';
import { getSecret } from '@/server/secrets';
import CsrfInit from '@/components/CsrfInit';
import { AppNav } from '@/components/AppNav';
import { readSessionToken, SESSION_COOKIE } from '@/server/auth';

export const metadata: Metadata = {
  title: 'Redi',
  description: 'Your degree-planning cloud companion',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();
  let aiConfigured = false;
  let authenticated = false;
  try {
    authenticated = (await readSessionToken(
      (await cookies()).get(SESSION_COOKIE)?.value,
    )).valid;
    aiConfigured = Boolean((await getSecret('ai.api_key')) && (await getSettings()).ai?.model);
  } catch {
    aiConfigured = false; // DB not ready yet (e.g. first boot before migrations)
  }
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <CsrfInit />
        {authenticated && <AppNav />}
        {children}
        <RediWidget aiConfigured={aiConfigured} pollStatus={authenticated} />
      </body>
    </html>
  );
}

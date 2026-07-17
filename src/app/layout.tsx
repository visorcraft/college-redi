import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { RediWidget } from '@/components/redi/RediWidget';
import { getSettings } from '@/server/settings';
import { getSecret } from '@/server/secrets';
import { NotificationBell } from '@/components/ui/NotificationBell';
import CsrfInit from '@/components/CsrfInit';

export const metadata: Metadata = {
  title: 'Redi',
  description: 'Your degree-planning cloud companion',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();
  let aiConfigured = false;
  try {
    aiConfigured = Boolean((await getSecret('ai.api_key')) && (await getSettings()).ai?.model);
  } catch {
    aiConfigured = false; // DB not ready yet (e.g. first boot before migrations)
  }
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <CsrfInit />
        {children}
        <NotificationBell />
        <RediWidget aiConfigured={aiConfigured} />
      </body>
    </html>
  );
}

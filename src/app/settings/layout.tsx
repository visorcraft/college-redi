import Link from 'next/link';

const NAV: ReadonlyArray<[string, string]> = [
  ['AI', '/settings/ai'],
  ['College email', '/settings/imap'],
  ['Personal email', '/settings/smtp'],
  ['Text messages', '/settings/twilio'],
  ['Notifications', '/settings/notifications'],
  ['Security', '/settings/security'],
  ['Status', '/settings/status'],
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-bold text-[#1F2D50]">Settings</h1>
      <nav aria-label="Settings sections" className="mb-6 flex flex-wrap gap-2">
        {NAV.map(([label, href]) => (
          <Link key={href} href={href} className="rounded-xl bg-white px-3 py-1.5 text-sm text-[#1F2D50] shadow-sm hover:bg-[#EAF3FB]">
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}

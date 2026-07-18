import Link from 'next/link';
import { headers } from 'next/headers';

const NAV: ReadonlyArray<[string, string]> = [
  ['AI', '/settings/ai'],
  ['College email', '/settings/imap'],
  ['Personal email', '/settings/smtp'],
  ['Text messages', '/settings/twilio'],
  ['Notifications', '/settings/notifications'],
  ['AI agent access', '/settings/agent'],
  ['Security', '/settings/security'],
  ['Status', '/settings/status'],
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const hostHeader = requestHeaders.get('host') ?? '';
  const host = hostHeader.startsWith('[')
    ? hostHeader.slice(1, hostHeader.indexOf(']'))
    : hostHeader.split(':')[0];
  const insecureRemote = requestHeaders.get('x-redi-secure') !== 'true'
    && !['localhost', '127.0.0.1', '::1'].includes(host);
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-bold text-[#1F2D50]">Settings</h1>
      {insecureRemote && (
        <p role="alert" className="mb-4 rounded-xl border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
          This Redi server is reachable without TLS. Use Tailscale or an HTTPS
          reverse proxy before exposing it beyond your local machine.
        </p>
      )}
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

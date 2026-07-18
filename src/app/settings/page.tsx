import Link from 'next/link';

const sections = [
  ['AI', 'Configure Redi’s model and provider.', '/settings/ai'],
  ['College email', 'Connect the inbox Redi monitors.', '/settings/imap'],
  ['Personal email', 'Choose where Redi sends summaries.', '/settings/smtp'],
  ['Text messages', 'Configure optional SMS alerts.', '/settings/twilio'],
  ['Notifications', 'Choose how and when Redi reaches you.', '/settings/notifications'],
  ['AI agent access', 'Let Claude, Kimi CLI, and other agents drive Redi over MCP.', '/settings/agent'],
  ['Security', 'Change your Redi password.', '/settings/security'],
  ['Status', 'Check Redi’s services and connections.', '/settings/status'],
] as const;

export default function SettingsPage() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sections.map(([title, description, href]) => (
        <Link
          key={href}
          href={href}
          className="rounded-2xl bg-white p-4 text-[#1F2D50] shadow-sm hover:bg-[#EAF3FB] focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
        >
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm opacity-75">{description}</p>
        </Link>
      ))}
    </div>
  );
}

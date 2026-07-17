import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSettings } from '@/server/settings';
import { getSecret } from '@/server/secrets';
import { readSessionToken, SESSION_COOKIE } from '@/server/auth';
import { WizardShell } from '@/components/wizard/WizardShell';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export const dynamic = 'force-dynamic';

export default async function WizardPage() {
  const hasPassword = (await getSecret('login.password_hash')) !== null;
  if (hasPassword) {
    const cookieStore = await cookies();
    const { valid } = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
    if (!valid) redirect('/login');
  }
  const settings = (await getSettings()) as unknown as SettingsSnapshot;
  if (settings.wizard_state?.completed) redirect('/');
  const secretFlags = {
    aiKey: (await getSecret('ai.api_key')) !== null,
    imapPassword: (await getSecret('imap.password')) !== null,
    smtpPassword: (await getSecret('smtp.password')) !== null,
    twilioToken: (await getSecret('twilio.auth_token')) !== null,
  };
  return <WizardShell initialSettings={settings} hasPassword={hasPassword} secretFlags={secretFlags} />;
}

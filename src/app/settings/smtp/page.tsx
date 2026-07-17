import { getSettings } from '@/server/settings';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SmtpStep } from '@/components/wizard/steps/SmtpStep';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export const dynamic = 'force-dynamic';

export default async function SmtpSettingsPage() {
  const settings = (await getSettings()) as unknown as SettingsSnapshot;
  return <SettingsSection step={<SmtpStep settings={settings} variant="settings" />} />;
}

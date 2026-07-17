import { getSettings } from '@/server/settings';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { ImapStep } from '@/components/wizard/steps/ImapStep';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export const dynamic = 'force-dynamic';

export default async function ImapSettingsPage() {
  const settings = (await getSettings()) as unknown as SettingsSnapshot;
  return <SettingsSection step={<ImapStep settings={settings} variant="settings" />} />;
}

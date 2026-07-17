import { getSettings } from '@/server/settings';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { TwilioStep } from '@/components/wizard/steps/TwilioStep';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export const dynamic = 'force-dynamic';

export default async function TwilioSettingsPage() {
  const settings = (await getSettings()) as unknown as SettingsSnapshot;
  return <SettingsSection step={<TwilioStep settings={settings} variant="settings" />} />;
}

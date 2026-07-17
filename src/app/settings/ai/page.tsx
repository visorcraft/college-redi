import { getSettings } from '@/server/settings';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { AiStep } from '@/components/wizard/steps/AiStep';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export const dynamic = 'force-dynamic';

export default async function AiSettingsPage() {
  const settings = (await getSettings()) as unknown as SettingsSnapshot;
  return <SettingsSection step={<AiStep settings={settings} />} />;
}

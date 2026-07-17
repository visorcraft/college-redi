import { getSettings } from '@/server/settings';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { NotificationsStep } from '@/components/wizard/steps/NotificationsStep';
import { TestConnectionButton } from '@/components/ui/TestConnectionButton';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export const dynamic = 'force-dynamic';

export default async function NotificationsSettingsPage() {
  const settings = (await getSettings()) as unknown as SettingsSnapshot;
  return (
    <SettingsSection
      step={<NotificationsStep settings={settings} />}
      after={
        <>
          <h3 className="mt-2 text-sm font-semibold text-[#1F2D50]">Send a test</h3>
          <div className="flex flex-col gap-3">
            <TestConnectionButton endpoint="/api/notifications/test/in_app" label="Test in-app" showRedi />
            <TestConnectionButton endpoint="/api/notifications/test/email" label="Test email" showRedi />
            <TestConnectionButton endpoint="/api/notifications/test/sms" label="Test SMS" showRedi />
          </div>
        </>
      }
    />
  );
}

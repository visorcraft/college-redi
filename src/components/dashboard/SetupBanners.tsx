import { getSettings } from '@/server/settings';
import { callTool } from '@/server/tools/call';
import { buildBanners } from '@/lib/banners';
import { BannerList } from './BannerList';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export default async function SetupBanners() {
  const settings = (await getSettings()) as unknown as SettingsSnapshot;
  let status: unknown = null;
  try {
    status = await callTool(
      'get_system_status',
      { probe_connections: false, probe_ai: true },
      { actor: 'user' },
    );
  } catch {
    status = null; // status tool unavailable — banners still work from settings alone
  }
  const banners = buildBanners(settings, status);
  if (banners.length === 0) return null;
  return <BannerList banners={banners} dismissed={settings.ui?.setup_dismissed ?? []} />;
}

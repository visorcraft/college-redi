import { callTool } from '@/server/tools/call';
import { StatusView } from '@/components/settings/StatusView';

export const dynamic = 'force-dynamic';

export default async function StatusSettingsPage() {
  let status: Record<string, unknown>;
  try {
    status = (await callTool('get_system_status', {}, { actor: 'user' })) as Record<string, unknown>;
  } catch (err) {
    status = { error: err instanceof Error ? err.message : String(err) };
  }
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-[#1F2D50]">Status</h2>
      <StatusView status={status} />
    </section>
  );
}

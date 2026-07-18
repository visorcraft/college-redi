import { NextResponse } from 'next/server';
import { buildBanners } from '@/lib/banners';
import type { SettingsSnapshot } from '@/lib/schemas/settings';
import { getSettings } from '@/server/settings';
import { callTool } from '@/server/tools/call';
import { apiError } from '../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CTX = { actor: 'user' };

export async function GET(): Promise<Response> {
  try {
    const [overdue, today, programs, status, settings] = await Promise.all([
      callTool('list_tasks', { due: 'overdue' }, CTX),
      callTool('list_tasks', { due: 'today' }, CTX),
      callTool('list_programs', { status: 'active' }, CTX),
      callTool('get_system_status', {
        probe_connections: false,
        probe_ai: true,
      }, CTX),
      getSettings(),
    ]);
    const program = Array.isArray(programs) ? programs[0] as { id: string } | undefined : undefined;
    const progress = program
      ? await callTool('get_degree_progress', { program_id: program.id }, CTX)
      : null;
    return NextResponse.json({
      today: { overdue, due_today: today },
      progress,
      banners: buildBanners(
        settings as unknown as SettingsSnapshot,
        status,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}

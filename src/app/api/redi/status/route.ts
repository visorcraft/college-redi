import { NextResponse } from 'next/server';
import { lit, sqlRows } from '../../../../server/db/sql';
import { getSecret } from '../../../../server/secrets';
import { getSettings } from '../../../../server/settings';
import { callTool } from '../../../../server/tools/call';
import { hasAiConfiguration } from '../../../../server/ai/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getSettings();
  const aiConfigured = hasAiConfiguration(
    await getSecret('ai.api_key'),
    settings.ai,
  );

  let unreadCount = 0;
  try {
    const result = await callTool(
      'list_notifications',
      { unread_only: true, limit: 500 },
      { actor: 'user' },
    ) as { notifications?: unknown[]; unread_count?: number };
    unreadCount = result.unread_count
      ?? (Array.isArray(result.notifications) ? result.notifications.length : 0);
  } catch {
    // The widget remains usable if notification tools are unavailable.
  }

  let jobRunning = false;
  try {
    jobRunning = (await sqlRows(
      `SELECT job_name FROM job_leases WHERE locked_until > ${lit(new Date())} ` +
      `AND last_status LIKE 'running:%'`,
    )).length > 0;
  } catch {
    // The widget remains usable before the leases table is ready.
  }

  return NextResponse.json({ aiConfigured, unreadCount, jobRunning });
}

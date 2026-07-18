import { NextResponse } from 'next/server';
import { ensureBootstrapped } from '@/server/bootstrap';
import { callTool } from '@/server/tools/call';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureBootstrapped();
  return NextResponse.json(await callTool(
    'get_system_status',
    { probe_connections: true },
    { actor: 'user' },
  ));
}

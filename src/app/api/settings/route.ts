import { NextResponse } from 'next/server';
import { ensureBootstrapped } from '@/server/bootstrap';
import { callTool } from '@/server/tools/call';
import { SettingsPatchSchema } from '@/lib/schemas/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureBootstrapped();
  return NextResponse.json(await callTool('get_settings', {}, { actor: 'user' }));
}

export async function PATCH(req: Request) {
  await ensureBootstrapped();
  const parsed = SettingsPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid settings patch.' } },
      { status: 400 },
    );
  }
  return NextResponse.json(await callTool('update_settings', parsed.data, { actor: 'user' }));
}

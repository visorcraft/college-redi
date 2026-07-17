import { NextResponse } from 'next/server';
import { ensureBootstrapped } from '@/server/bootstrap';
import { callTool } from '@/server/tools/call';
import { SecretPutSchema } from '@/lib/schemas/settings';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  await ensureBootstrapped();
  const parsed = SecretPutSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Unknown secret name or empty value.' } },
      { status: 400 },
    );
  }
  await callTool('set_secret', parsed.data, { actor: 'user' });
  return NextResponse.json({ ok: true });
}

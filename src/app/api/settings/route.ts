import { NextResponse, type NextRequest } from 'next/server';
import { ensureBootstrapped } from '@/server/bootstrap';
import { jsonError } from '@/server/http';
import { callTool, ToolValidationError } from '@/server/tools/call';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureBootstrapped();
  return NextResponse.json(await callTool('get_settings', {}, { actor: 'user' }));
}

export async function PATCH(req: NextRequest) {
  await ensureBootstrapped();
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError('invalid_body', 'Expected a JSON object of settings to merge.', 400);
  }
  try {
    return NextResponse.json(await callTool('update_settings', body, { actor: 'user' }));
  } catch (err) {
    if (err instanceof ToolValidationError) return jsonError('invalid_params', err.message, 400);
    throw err;
  }
}

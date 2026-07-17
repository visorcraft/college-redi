import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import { ensureBootstrapped } from '@/server/bootstrap';
import { jsonError } from '@/server/http';
import { callTool, ToolValidationError } from '@/server/tools/call';
import { SECRET_NAMES } from '@/server/tools/settings';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ name: z.enum(SECRET_NAMES), value: z.string().min(1) });

export async function PUT(req: NextRequest) {
  await ensureBootstrapped();
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return jsonError('invalid_body', `Expected { name: one of ${SECRET_NAMES.join(', ')}, value: non-empty string }.`, 400);
  }
  try {
    return NextResponse.json(await callTool('set_secret', body.data, { actor: 'user' }));
  } catch (err) {
    if (err instanceof ToolValidationError) return jsonError('invalid_params', err.message, 400);
    throw err;
  }
}

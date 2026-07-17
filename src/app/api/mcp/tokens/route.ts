import { NextResponse } from 'next/server';
import { callTool } from '../../../../server/tools/call';
import { createMcpTokenSchema } from '../../../../server/tools/mcpTokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const tokens = await callTool('list_mcp_tokens', {}, { actor: 'user' });
  return NextResponse.json({ tokens });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = createMcpTokenSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({
      error: {
        code: 'invalid_params',
        message: parsed.error.issues[0]?.message ?? 'invalid request body',
      },
    }, { status: 400 });
  }
  const created = await callTool(
    'create_mcp_token',
    parsed.data,
    { actor: 'user' },
  );
  return NextResponse.json(created, { status: 201 });
}

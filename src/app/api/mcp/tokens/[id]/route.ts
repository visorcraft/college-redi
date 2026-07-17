import { NextResponse } from 'next/server';
import { callTool } from '../../../../../server/tools/call';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const result = await callTool(
    'revoke_mcp_token',
    { id, confirm: true },
    { actor: 'user' },
  ) as { id: string; revoked: boolean };
  if (!result.revoked) {
    return NextResponse.json({
      error: { code: 'not_found', message: 'token not found' },
    }, { status: 404 });
  }
  return NextResponse.json(result);
}

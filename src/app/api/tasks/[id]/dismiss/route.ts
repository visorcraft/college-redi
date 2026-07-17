import { NextRequest, NextResponse } from 'next/server';
import { callTool } from '../../../../../server/tools/call';
import { apiError } from '../../../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    return NextResponse.json(await callTool('dismiss_task', { id }, { actor: 'user' }));
  } catch (error) {
    return apiError(error);
  }
}

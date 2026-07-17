import { NextRequest, NextResponse } from 'next/server';
import { callTool } from '../../../../server/tools/call';
import { apiError } from '../../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CTX = { actor: 'user' };
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    return NextResponse.json(await callTool('update_task', { ...await request.json(), id }, CTX));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    return NextResponse.json(await callTool('delete_task', { id, confirm: true }, CTX));
  } catch (error) {
    return apiError(error);
  }
}

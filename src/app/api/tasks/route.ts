import { NextRequest, NextResponse } from 'next/server';
import { callTool } from '../../../server/tools/call';
import { materializePendingChecklist } from '../../../server/tools/tasks';
import { apiError } from '../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CTX = { actor: 'user' };

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await materializePendingChecklist();
    const query = request.nextUrl.searchParams;
    const params: Record<string, unknown> = {};
    for (const key of ['status', 'category', 'due'] as const) {
      const value = query.get(key);
      if (value) params[key] = value;
    }
    const limit = query.get('limit');
    if (limit) params.limit = Number(limit);
    return NextResponse.json(await callTool('list_tasks', params, CTX));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    return NextResponse.json(await callTool('create_task', await request.json(), CTX), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

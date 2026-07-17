import { NextRequest, NextResponse } from 'next/server';
import { callTool } from '../../../../server/tools/call';
import { apiError } from '../../_utils';

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams;
    return NextResponse.json(await callTool('get_notification_history', {
      notification_id: query.get('notification_id') ?? undefined,
      limit: query.get('limit') ? Number(query.get('limit')) : 100,
    }, { actor: 'user' }));
  } catch (error) {
    return apiError(error);
  }
}

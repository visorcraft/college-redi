import { NextRequest, NextResponse } from 'next/server';
import { callTool } from '../../../server/tools/call';
import { apiError } from '../_utils';

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams;
    return NextResponse.json(await callTool('list_notifications', {
      unread_only: query.get('unread_only') === 'true',
      limit: query.get('limit') ? Number(query.get('limit')) : 50,
    }, { actor: 'user' }));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(
      await callTool('schedule_notification', await req.json(), { actor: 'user' }),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

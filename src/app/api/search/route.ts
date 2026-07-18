import { NextRequest, NextResponse } from 'next/server';
import { callTool } from '@/server/tools/call';
import { apiError } from '../_utils';

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams;
    return NextResponse.json(await callTool('search_all', {
      query: query.get('query') ?? '',
      limit: query.get('limit') ? Number(query.get('limit')) : undefined,
    }, { actor: 'user' }));
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from 'next/server';
import { callTool } from '@/server/tools/call';
import { listExtractedEventsParams } from '@/server/tools/email';
import { apiError } from '../_utils';

export async function GET(req: Request) {
  try {
    const query = new URL(req.url).searchParams;
    const params = listExtractedEventsParams.parse({
      status: query.get('status') ?? undefined,
      limit: query.get('limit') ?? undefined,
      offset: query.get('offset') ?? undefined,
    });
    return NextResponse.json(await callTool(
      'list_extracted_events',
      params,
      { actor: 'user' },
    ));
  } catch (error) {
    return apiError(error);
  }
}

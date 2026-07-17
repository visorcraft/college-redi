import { NextResponse } from 'next/server';
import { callTool } from '@/server/tools/call';
import { listProcessedEmailsParams } from '@/server/tools/email';
import { apiError } from '../../_utils';

export async function GET(req: Request) {
  try {
    const query = new URL(req.url).searchParams;
    const params = listProcessedEmailsParams.parse({
      classification: query.get('classification') ?? undefined,
      since: query.get('since') ?? undefined,
      limit: query.get('limit') ?? undefined,
      offset: query.get('offset') ?? undefined,
    });
    return NextResponse.json(await callTool(
      'list_processed_emails',
      params,
      { actor: 'user' },
    ));
  } catch (error) {
    return apiError(error);
  }
}

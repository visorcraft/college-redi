import { NextResponse } from 'next/server';
import { callTool } from '@/server/tools/call';
import { apiError } from '../../../_utils';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(await callTool(
      'get_email_detail',
      { id: (await context.params).id },
      { actor: 'user' },
    ));
  } catch (error) {
    return apiError(error);
  }
}

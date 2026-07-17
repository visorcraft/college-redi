import { NextRequest, NextResponse } from 'next/server';
import { callTool } from '../../../../../server/tools/call';
import { apiError } from '../../../_utils';

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(await callTool(
      'mark_notification_read',
      { id: (await context.params).id },
      { actor: 'user' },
    ));
  } catch (error) {
    return apiError(error);
  }
}

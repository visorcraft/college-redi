import { NextResponse } from 'next/server';
import { callTool } from '../../../../server/tools/call';
import { apiError } from '../../_utils';

export async function POST() {
  try {
    return NextResponse.json(await callTool(
      'mark_all_notifications_read',
      {},
      { actor: 'user' },
    ));
  } catch (error) {
    return apiError(error);
  }
}

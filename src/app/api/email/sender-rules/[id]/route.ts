import { NextResponse } from 'next/server';
import { callTool } from '@/server/tools/call';
import { apiError } from '../../../_utils';

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(await callTool(
      'remove_sender_rule',
      { id: (await context.params).id, confirm: true },
      { actor: 'user' },
    ));
  } catch (error) {
    return apiError(error);
  }
}

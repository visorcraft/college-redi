import { NextResponse } from 'next/server';
import {
  getConversation,
  listMessages,
} from '../../../../../server/chat/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const conversation = await getConversation(id);
  if (!conversation) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Conversation not found' } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    conversation,
    messages: await listMessages(id, 200),
  });
}

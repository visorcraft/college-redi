import { NextResponse } from 'next/server';
import { createConversationSchema } from '../../../../lib/schemas/chat';
import {
  createConversation,
  listConversations,
} from '../../../../server/chat/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ conversations: await listConversations() });
}

export async function POST(request: Request) {
  const body = createConversationSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!body.success) {
    return NextResponse.json(
      { error: { code: 'invalid_body', message: 'Invalid conversation body' } },
      { status: 400 },
    );
  }
  const conversation = await createConversation(body.data.title ?? 'New chat');
  return NextResponse.json(
    { id: conversation.id, title: conversation.title },
    { status: 201 },
  );
}

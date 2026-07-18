import { NextResponse } from 'next/server';
import { sendChatMessageSchema } from '../../../../../../lib/schemas/chat';
import { runAgentTurn } from '../../../../../../server/ai/agent';
import {
  AiDailyCapExceededError,
  AiNotConfiguredError,
  getAiClient,
} from '../../../../../../server/ai/client';
import { getConversation } from '../../../../../../server/chat/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!await getConversation(id)) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Conversation not found' } },
      { status: 404 },
    );
  }
  const body = sendChatMessageSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!body.success) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_body',
          message: 'message must be 1-4000 characters',
        },
      },
      { status: 400 },
    );
  }
  try {
    await getAiClient();
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return NextResponse.json(
        {
          error: {
            code: 'ai_not_configured',
            message: error.message,
          },
        },
        { status: 503 },
      );
    }
    throw error;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        await runAgentTurn(id, body.data.message, (event) => {
          if (event.type === 'delta') send('delta', { text: event.text });
          else if (event.type === 'tool_start') {
            send('tool', { phase: 'start', name: event.name });
          } else if (event.type === 'tool_end') {
            send('tool', { phase: 'end', name: event.name });
          } else if (event.type === 'ephemeral_result') {
            send('ephemeral', { name: event.name, result: event.result });
          } else if (event.type === 'done') send('done', { text: event.text });
        });
      } catch (error) {
        const expected = error instanceof AiDailyCapExceededError
          || error instanceof AiNotConfiguredError;
        if (!expected) {
          console.error(JSON.stringify({
            level: 'error',
            msg: 'chat turn failed',
            error_name: error instanceof Error ? error.name : typeof error,
          }));
        }
        send('error', {
          message: expected
            ? error.message
            : 'Redi hit a snag. Please try again.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubReply {
  content?: string;
  toolCalls?: Array<{ name: string; arguments: string }>;
  finishDelayMs?: number;
}

export interface StubServer {
  url: string;
  requests: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

export async function startStubAiServer(replies: StubReply[]): Promise<StubServer> {
  const queue = [...replies];
  const requests: Array<Record<string, unknown>> = [];
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end('not found');
      return;
    }
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', async () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      requests.push(parsed);
      const reply = queue.shift();
      if (!reply) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'stub script exhausted' } }));
        return;
      }
      const toolCalls = (reply.toolCalls ?? []).map((toolCall, index) => ({
        id: `call_${requests.length}_${index}`,
        type: 'function' as const,
        function: { name: toolCall.name, arguments: toolCall.arguments },
      }));
      const finishReason = toolCalls.length ? 'tool_calls' : 'stop';
      if (parsed.stream) {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        const send = (value: unknown) =>
          response.write(`data: ${JSON.stringify(value)}\n\n`);
        const chunk = (delta: unknown, finish: string | null = null) => ({
          id: 'chatcmpl-stub',
          object: 'chat.completion.chunk',
          created: 0,
          model: parsed.model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        });
        if (toolCalls.length) {
          if (reply.content) send(chunk({ role: 'assistant', content: reply.content }));
          for (const [index, toolCall] of toolCalls.entries()) {
            send(chunk({
              tool_calls: [{
                index,
                id: toolCall.id,
                type: 'function',
                function: { name: toolCall.function.name, arguments: '' },
              }],
            }));
            send(chunk({
              tool_calls: [{
                index,
                function: { arguments: toolCall.function.arguments },
              }],
            }));
          }
        } else {
          send(chunk({ role: 'assistant', content: reply.content ?? '' }));
        }
        if (reply.finishDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, reply.finishDelayMs));
        }
        send(chunk({}, finishReason));
        response.write('data: [DONE]\n\n');
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'chatcmpl-stub',
        object: 'chat.completion',
        created: 0,
        model: parsed.model,
        choices: [{
          index: 0,
          finish_reason: finishReason,
          message: {
            role: 'assistant',
            content: reply.content ?? null,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

import {
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildMcpServer, verifyMcpToken } from '../../server/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleMcp(request: Request): Promise<Response> {
  const token = /^Bearer\s+(.+)$/i
    .exec(request.headers.get('authorization') ?? '')?.[1]
    ?.trim();
  const principal = token ? await verifyMcpToken(token) : null;
  if (!principal) {
    return Response.json({
      error: {
        code: 'unauthorized',
        message:
          'A valid MCP Bearer token is required. Create one in Settings → AI agent access.',
      },
    }, { status: 401 });
  }

  const server = buildMcpServer(`mcp:${principal.name}`);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}

export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { setupTestEnv, teardownTestEnv } from '../helpers/testEnv';

let dataDir = '';
let httpServer: Server;
let mcpUrl = '';
let rawToken = '';

const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'x', version: '1' },
  },
});

function postRaw(headers: Record<string, string>): Promise<Response> {
  return fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: INIT_BODY,
  });
}

beforeAll(async () => {
  dataDir = await setupTestEnv('redi-mcp-conf-');
  const route = await import('../../src/app/mcp/route');
  const { callTool } = await import('../../src/server/tools/call');
  rawToken = await callTool(
    'create_mcp_token',
    { name: 'conformance' },
    { actor: 'user' },
  ).then((result) => (result as { token: string }).token);

  httpServer = createServer((
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    void (async () => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value === 'string') headers.set(key, value);
        }
        const webRequest = new Request(
          `http://127.0.0.1${request.url ?? '/mcp'}`,
          {
            method: request.method,
            headers,
            body: body.length ? body : undefined,
          },
        );
        const handlers: Record<string, (input: Request) => Promise<Response>> = {
          POST: route.POST,
          GET: route.GET,
          DELETE: route.DELETE,
        };
        const webResponse = await (
          handlers[request.method ?? 'POST'] ?? route.POST
        )(webRequest);
        const out: Record<string, string> = {};
        webResponse.headers.forEach((value, key) => {
          out[key] = value;
        });
        response.writeHead(webResponse.status, out);
        response.end(Buffer.from(await webResponse.arrayBuffer()));
      } catch (error) {
        response.writeHead(500).end(String(error));
      }
    })();
  });
  await new Promise<void>((resolve) =>
    httpServer.listen(0, '127.0.0.1', resolve),
  );
  mcpUrl =
    `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await teardownTestEnv(dataDir);
});

async function connectClient(token: string) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  );
  const client = new Client({ name: 'conformance-test', version: '0.0.1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  }));
  return client;
}

function parseToolJson(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    throw new Error('MCP result has no content');
  }
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

describe('MCP conformance', () => {
  it('rejects missing or invalid Bearer tokens', async () => {
    expect((await postRaw({})).status).toBe(401);
    expect((await postRaw({
      authorization:
        `Bearer redi_${crypto.randomUUID()}_${'A'.repeat(43)}`,
    })).status).toBe(401);
  });

  it('lists the full canonical registry with identical schemas', async () => {
    const client = await connectClient(rawToken);
    expect(client.getServerVersion()).toEqual({
      name: 'redi',
      version: packageJson.version,
    });
    const { tools } = await client.listTools();
    const { getAllTools } = await import('../../src/server/tools/registry');
    const registry = getAllTools();
    expect(tools.map((tool) => tool.name).sort())
      .toEqual(registry.map((tool) => tool.name).sort());
    for (const tool of registry) {
      const advertised = tools.find(({ name }) => name === tool.name);
      expect(advertised?.description).toBe(tool.description);
      expect(advertised?.inputSchema).toEqual(tool.jsonSchema);
    }
    await client.close();
  });

  it('round-trips tools and stamps the MCP audit actor', async () => {
    const client = await connectClient(rawToken);
    const read = await client.callTool({
      name: 'get_system_status',
      arguments: {},
    });
    expect(read.isError).toBeFalsy();
    expect(parseToolJson(read)).toBeTypeOf('object');

    const write = await client.callTool({
      name: 'create_task',
      arguments: { title: 'MCP conformance task' },
    });
    expect(write.isError).toBeFalsy();

    const { queryRows } = await import('../../src/server/db/sql');
    const audit = await queryRows<{ actor: string }>(
      "SELECT actor FROM audit_log WHERE actor = 'mcp:conformance' " +
      "AND tool_name = 'create_task'",
    );
    expect(audit.length).toBeGreaterThanOrEqual(1);
    await client.close();
  });

  it('allows the full catalog through a named bearer token', async () => {
    const client = await connectClient(rawToken);
    const createdResult = await client.callTool({
      name: 'create_mcp_token',
      arguments: { name: 'via-mcp' },
    });
    expect(createdResult.isError).toBeFalsy();
    const created = parseToolJson(createdResult) as { id: string; token: string };
    const listed = await client.callTool({
      name: 'list_mcp_tokens',
      arguments: {},
    });
    expect(parseToolJson(listed)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    );
    expect((await client.callTool({
      name: 'revoke_mcp_token',
      arguments: { id: created.id, confirm: true },
    })).isError).toBeFalsy();
    await client.close();
  });

  it('serves four read-only JSON resources', async () => {
    const client = await connectClient(rawToken);
    const { resources } = await client.listResources();
    expect(resources.map(({ uri }) => uri).sort()).toEqual([
      'redi://degree/progress',
      'redi://emails/recent-summaries',
      'redi://notifications/recent',
      'redi://tasks/open',
    ]);
    for (const uri of resources.map((resource) => resource.uri)) {
      const result = await client.readResource({ uri });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');
      const content = result.contents[0];
      expect(() => JSON.parse(
        'text' in content ? content.text : Buffer.from(content.blob, 'base64').toString(),
      )).not.toThrow();
    }
    await client.close();
  });

  it('applies revocation on the next request', async () => {
    const { callTool } = await import('../../src/server/tools/call');
    const token = await callTool(
      'create_mcp_token',
      { name: 'short-lived' },
      { actor: 'user' },
    ) as { id: string; token: string };
    await callTool(
      'revoke_mcp_token',
      { id: token.id, confirm: true },
      { actor: 'user' },
    );
    expect((await postRaw({
      authorization: `Bearer ${token.token}`,
    })).status).toBe(401);
  });
});

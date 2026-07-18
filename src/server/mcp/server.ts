import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { callTool } from '../tools/call';
import { getAllTools } from '../tools/registry';

export { verifyMcpToken } from '../tools/mcpTokens';

function mcpTools() {
  return getAllTools();
}

function asArray(result: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object') {
    for (const key of keys) {
      const value = (result as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

interface McpResourceDef {
  uri: string;
  name: string;
  description: string;
  load: (actor: string) => Promise<unknown>;
}

const RESOURCES: McpResourceDef[] = [
  {
    uri: 'redi://degree/progress',
    name: 'Degree progress',
    description:
      'Overall degree progress, requirement status, credits, projection, and risk flags.',
    load: (actor) => callTool('get_degree_progress', {}, { actor }),
  },
  {
    uri: 'redi://tasks/open',
    name: 'Open tasks',
    description: 'Tasks still pending or awaiting confirmation.',
    load: async (actor) => asArray(
      await callTool('list_tasks', {}, { actor }),
      'tasks',
    ).filter((task) => {
      const status = (task as { status?: unknown }).status;
      return status === 'pending' || status === 'awaiting_confirmation';
    }),
  },
  {
    uri: 'redi://notifications/recent',
    name: 'Recent notifications',
    description: 'The 20 most recent in-app notifications.',
    load: async (actor) => asArray(
      await callTool('list_notifications', {}, { actor }),
      'notifications',
    ).slice(0, 20),
  },
  {
    uri: 'redi://emails/recent-summaries',
    name: 'Recent email summaries',
    description: 'The 20 most recent non-junk college email summaries.',
    load: async (actor) => asArray(
      await callTool('list_processed_emails', {}, { actor }),
      'emails',
    ).filter((email) =>
      (email as { classification?: unknown }).classification !== 'junk',
    ).slice(0, 20),
  },
];

export function buildMcpServer(actor: string): Server {
  const server = new Server(
    { name: 'redi', version: '0.1.3' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.jsonSchema as { type: 'object' } & Record<string, unknown>,
      annotations: {
        readOnlyHint: tool.sideEffect === 'read',
        destructiveHint: tool.sideEffect === 'destructive',
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (!mcpTools().some(({ name }) => name === request.params.name)) {
        throw new Error(`Tool unavailable over MCP: ${request.params.name}`);
      }
      const result = await callTool(
        request.params.name,
        request.params.arguments ?? {},
        { actor },
      );
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result ?? null, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES.map(({ uri, name, description }) => ({
      uri,
      name,
      description,
      mimeType: 'application/json',
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = RESOURCES.find(({ uri }) => uri === request.params.uri);
    if (!resource) throw new Error(`Unknown resource: ${request.params.uri}`);
    let data: unknown;
    try {
      data = await resource.load(actor);
    } catch (error) {
      data = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      contents: [{
        uri: resource.uri,
        mimeType: 'application/json',
        text: JSON.stringify(data ?? null, null, 2),
      }],
    };
  });

  return server;
}

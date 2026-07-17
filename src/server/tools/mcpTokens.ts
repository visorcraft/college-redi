import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { execSql, queryRows, sqlString } from '../db/sql';
import type { Tool } from './registry';

export const createMcpTokenSchema = z.object({
  name: z.string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9 ._:-]*$/,
      'letters, digits, spaces and . _ : - only',
    ),
});
export const listMcpTokensSchema = z.object({});
export const revokeMcpTokenSchema = z.object({
  id: z.string().uuid(),
  confirm: z.literal(true),
});

export interface McpTokenRow {
  id: string;
  name: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function insertMcpToken(name: string): Promise<{
  id: string;
  name: string;
  token: string;
  created_at: string;
}> {
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const tokenHash = await argon2.hash(secret, { type: argon2.argon2id });
  const createdAt = new Date().toISOString();
  await execSql(
    `INSERT INTO mcp_tokens (id, name, token_hash, created_at) VALUES (` +
    `${sqlString(id)}, ${sqlString(name)}, ${sqlString(tokenHash)}, ` +
    `${sqlString(createdAt)})`,
  );
  return {
    id,
    name,
    token: `redi_${id}_${secret}`,
    created_at: createdAt,
  };
}

export async function listActiveMcpTokens(): Promise<
  Array<Omit<McpTokenRow, 'token_hash'>>
> {
  const rows = await queryRows<McpTokenRow>(
    'SELECT id, name, created_at, last_used_at, revoked_at FROM mcp_tokens ' +
    'WHERE revoked_at IS NULL ORDER BY created_at ASC',
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    created_at: String(row.created_at),
    last_used_at: row.last_used_at === null ? null : String(row.last_used_at),
    revoked_at: row.revoked_at === null ? null : String(row.revoked_at),
  }));
}

export async function revokeMcpToken(id: string): Promise<boolean> {
  await execSql(
    `UPDATE mcp_tokens SET revoked_at = ${sqlString(new Date().toISOString())} ` +
    `WHERE id = ${sqlString(id)} AND revoked_at IS NULL`,
  );
  return (await queryRows<{ id: string }>(
    `SELECT id FROM mcp_tokens WHERE id = ${sqlString(id)}`,
  )).length > 0;
}

export async function verifyMcpToken(
  rawToken: string,
): Promise<{ id: string; name: string } | null> {
  const match =
    /^redi_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/
      .exec(rawToken);
  if (!match) return null;
  const id = match[1];
  const secret = match[2];
  const row = (await queryRows<{
    id: string;
    name: string;
    token_hash: string;
  }>(
    `SELECT id, name, token_hash FROM mcp_tokens ` +
    `WHERE id = ${sqlString(id)} AND revoked_at IS NULL`,
  ))[0];
  if (!row || !await argon2.verify(row.token_hash, secret)) return null;
  await execSql(
    `UPDATE mcp_tokens SET last_used_at = ${sqlString(new Date().toISOString())} ` +
    `WHERE id = ${sqlString(row.id)}`,
  );
  return { id: row.id, name: row.name };
}

export const mcpTokenTools: Tool[] = [
  {
    name: 'create_mcp_token',
    description:
      'Create a named MCP access token for an external AI agent (e.g. "laptop-claude"). The raw token is returned exactly once in this response; copy it immediately. Only its Argon2id hash is stored. Tokens authenticate Bearer access to the /mcp endpoint.',
    sideEffect: 'write',
    paramsSchema: createMcpTokenSchema,
    jsonSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          description: 'Client label, e.g. "laptop-claude"',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async (_context, params) => {
      const parsed = createMcpTokenSchema.parse(params);
      return insertMcpToken(parsed.name);
    },
  },
  {
    name: 'list_mcp_tokens',
    description:
      'List active (non-revoked) MCP access tokens: id, name, created_at, last_used_at. Raw tokens and hashes are never returned.',
    sideEffect: 'read',
    paramsSchema: listMcpTokensSchema,
    jsonSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: async () => listActiveMcpTokens(),
  },
  {
    name: 'revoke_mcp_token',
    description:
      'Revoke an MCP access token by id so it can no longer authenticate. Destructive: requires confirm: true. Takes effect on the very next request.',
    sideEffect: 'destructive',
    paramsSchema: revokeMcpTokenSchema,
    jsonSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        confirm: { type: 'boolean', const: true },
      },
      required: ['id', 'confirm'],
      additionalProperties: false,
    },
    handler: async (_context, params) => {
      const parsed = revokeMcpTokenSchema.parse(params);
      return {
        id: parsed.id,
        revoked: await revokeMcpToken(parsed.id),
      };
    },
  },
];

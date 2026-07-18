import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv, teardownTestEnv } from '../helpers/testEnv';

let dataDir = '';

beforeAll(async () => {
  dataDir = await setupTestEnv('redi-mcp-tokens-');
});
afterAll(async () => {
  await teardownTestEnv(dataDir);
});

describe('mcp token tools', () => {
  it('returns the raw token once and stores only its Argon2id hash', async () => {
    const { callTool } = await import('../../src/server/tools/call');
    const created = await callTool(
      'create_mcp_token',
      { name: 'laptop-claude' },
      { actor: 'user' },
    ) as { id: string; name: string; token: string; created_at: string };
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.name).toBe('laptop-claude');
    expect(created.token)
      .toMatch(/^redi_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/);
    const { queryRows } = await import('../../src/server/db/sql');
    const rows = await queryRows<{ token_hash: string }>(
      `SELECT token_hash FROM mcp_tokens WHERE id = '${created.id}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toContain('$argon2id$');
    expect(rows[0].token_hash).not.toContain(created.token.slice(-43));
    await expect(callTool(
      'create_mcp_token',
      { name: '' },
      { actor: 'user' },
    )).rejects.toThrow();
    await expect(callTool(
      'create_mcp_token',
      { name: 'x'.repeat(65) },
      { actor: 'user' },
    )).rejects.toThrow();
  });

  it('lists active tokens without hashes', async () => {
    const { callTool } = await import('../../src/server/tools/call');
    const list = await callTool(
      'list_mcp_tokens',
      {},
      { actor: 'user' },
    ) as Array<Record<string, unknown>>;
    const token = list.find((row) => row.name === 'laptop-claude');
    expect(token).toBeTruthy();
    expect(token).not.toHaveProperty('token_hash');
  });

  it('verifies, stamps use time, and rejects garbage or revoked tokens', async () => {
    const { callTool } = await import('../../src/server/tools/call');
    const { verifyMcpToken } = await import('../../src/server/tools/mcpTokens');
    const created = await callTool(
      'create_mcp_token',
      { name: 'verify-me' },
      { actor: 'user' },
    ) as { id: string; token: string };
    expect(await verifyMcpToken('not-a-token')).toBeNull();
    expect(await verifyMcpToken(
      `redi_${created.id}_${'A'.repeat(43)}`,
    )).toBeNull();
    expect(await verifyMcpToken(created.token))
      .toEqual({
        id: created.id,
        name: 'verify-me',
      });
    const { queryRows } = await import('../../src/server/db/sql');
    const rows = await queryRows<{ last_used_at: string | null }>(
      `SELECT last_used_at FROM mcp_tokens WHERE id = '${created.id}'`,
    );
    expect(rows[0].last_used_at).not.toBeNull();
    await callTool(
      'revoke_mcp_token',
      { id: created.id, confirm: true },
      { actor: 'user' },
    );
    expect(await verifyMcpToken(created.token)).toBeNull();
  });

  it('requires confirmation and reports unknown ids', async () => {
    const { callTool } = await import('../../src/server/tools/call');
    const created = await callTool(
      'create_mcp_token',
      { name: 'revoke-me' },
      { actor: 'user' },
    ) as { id: string };
    await expect(callTool(
      'revoke_mcp_token',
      { id: created.id, confirm: false },
      { actor: 'user' },
    )).rejects.toThrow();
    await expect(callTool(
      'revoke_mcp_token',
      { id: created.id },
      { actor: 'user' },
    )).rejects.toThrow();
    expect(await callTool(
      'revoke_mcp_token',
      { id: created.id, confirm: true },
      { actor: 'user' },
    )).toMatchObject({ revoked: true });
    expect(await callTool(
      'revoke_mcp_token',
      { id: crypto.randomUUID(), confirm: true },
      { actor: 'user' },
    )).toMatchObject({ revoked: false });
  });
});

describe('mcp token REST routes', () => {
  it('creates, lists, revokes, and maps invalid or missing tokens', async () => {
    const { GET, POST } = await import('../../src/app/api/mcp/tokens/route');
    const { DELETE } = await import('../../src/app/api/mcp/tokens/[id]/route');
    const jsonRequest = (body: unknown) => new Request(
      'http://test/api/mcp/tokens',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const response = await POST(jsonRequest({ name: 'rest-token' }));
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string; token: string };
    expect((await POST(jsonRequest({ name: '' }))).status).toBe(400);
    const list = await (await GET()).json() as {
      tokens: Array<{ id: string }>;
    };
    expect(list.tokens.some((token) => token.id === created.id)).toBe(true);
    expect((await DELETE(
      new Request('http://test'),
      { params: Promise.resolve({ id: created.id }) },
    )).status).toBe(200);
    expect((await DELETE(
      new Request('http://test'),
      { params: Promise.resolve({ id: crypto.randomUUID() }) },
    )).status).toBe(404);
  });
});

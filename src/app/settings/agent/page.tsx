'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';

interface TokenInfo {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

function snippet(origin: string): string {
  return JSON.stringify({
    mcpServers: {
      redi: {
        command: 'npx',
        args: [
          'mcp-remote',
          `${origin}/mcp`,
          '--header',
          'Authorization: Bearer PASTE_TOKEN_HERE',
        ],
      },
    },
  }, null, 2);
}

export default function AgentAccessPage() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [name, setName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState('http://localhost:3000');

  const load = useCallback(async () => {
    const data = await apiFetch('/api/mcp/tokens') as { tokens: TokenInfo[] };
    setTokens(data.tokens);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load().catch(() => setError('Could not load tokens'));
  }, [load]);

  async function create() {
    setError(null);
    try {
      const created = await apiFetch('/api/mcp/tokens', {
        method: 'POST',
        body: { name: name.trim() },
      }) as { token: string };
      setCreatedToken(created.token);
      setName('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create token');
    }
  }

  async function revoke(id: string, tokenName: string) {
    if (!window.confirm(
      `Revoke "${tokenName}"? Any agent using it stops working immediately.`,
    )) return;
    try {
      await apiFetch(`/api/mcp/tokens/${id}`, { method: 'DELETE' });
      setCreatedToken(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke token');
    }
  }

  return (
    <div className="text-[#1F2D50]">
      <h2 className="mb-2 text-2xl font-bold">AI agent access</h2>
      <p className="mb-6 text-sm">
        Let your own AI agent, including Claude Desktop or Kimi CLI, drive Redi
        over MCP. Tokens appear once and are stored only as hashes.
      </p>

      <section className="mb-6 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold">Create a token</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            aria-label="Token name"
            className="flex-1 rounded-xl border border-[#1F2D50]/20 px-3 py-2"
            placeholder="e.g. laptop-claude"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="button"
            className="rounded-xl bg-[#1F2D50] px-4 py-2 font-semibold text-white disabled:opacity-40"
            disabled={!name.trim()}
            onClick={() => void create()}
          >
            Create token
          </button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {createdToken && (
          <div className="mt-4 rounded-xl border-2 border-[#FFC24B] bg-[#EAF3FB] p-3">
            <p className="mb-1 text-sm font-semibold">
              Copy this token now. It will never be shown again:
            </p>
            <code
              data-testid="mcp-token-value"
              className="block break-all rounded-lg bg-white p-2 text-xs"
            >
              {createdToken}
            </code>
            <button
              type="button"
              className="mt-2 rounded-xl bg-[#FFC24B] px-3 py-1 text-sm font-semibold"
              onClick={() => void navigator.clipboard.writeText(createdToken)}
            >
              Copy
            </button>
          </div>
        )}
      </section>

      <section className="mb-6 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold">Active tokens</h3>
        {tokens.length === 0 && (
          <p className="text-sm opacity-70">No tokens yet.</p>
        )}
        <ul className="space-y-2">
          {tokens.map((token) => (
            <li
              key={token.id}
              className="flex flex-col justify-between gap-2 rounded-xl bg-[#EAF3FB] px-3 py-2 text-sm sm:flex-row sm:items-center"
            >
              <span>
                <span className="font-semibold">{token.name}</span>
                <span className="ml-2 opacity-70">
                  created {new Date(token.created_at).toLocaleDateString()}
                  {token.last_used_at
                    ? ` · last used ${new Date(token.last_used_at).toLocaleString()}`
                    : ' · never used'}
                </span>
              </span>
              <button
                type="button"
                className="rounded-xl border border-red-300 px-3 py-1 text-red-700"
                onClick={() => void revoke(token.id, token.name)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold">Connect a client</h3>
        <p className="mb-2 text-sm">
          Paste this into your client config, then replace{' '}
          <code>PASTE_TOKEN_HERE</code> with a token from above:
        </p>
        <pre className="overflow-x-auto rounded-xl bg-[#1F2D50] p-3 text-xs text-white">
          {snippet(origin)}
        </pre>
      </section>
    </div>
  );
}

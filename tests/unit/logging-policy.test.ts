import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  setupTestEnv,
  teardownTestEnv,
} from '../helpers/testEnv';

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (path.endsWith('.ts')) yield path;
  }
}

describe('§16 logging rules: static scan', () => {
  it('never logs secret-bearing variables, raw bodies, or bare console.log', () => {
    const secretLeak = /(console\.(log|info|warn|error|debug)|logger\.[a-z]+)\s*\([^)]*\b(password|apiKey|api_key|authToken|auth_token|ciphertext|tokenHash|token_hash|rawToken|emailBody|rawBody|promptBody|chatBody)\b/i;
    const bareConsoleLog = /\bconsole\.log\s*\(/;
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), 'src/server'))) {
      for (const [index, line] of readFileSync(file, 'utf8')
        .split('\n')
        .entries()) {
        if (secretLeak.test(line) || bareConsoleLog.test(line)) {
          offenders.push(`${file}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('§16 logging rules: runtime', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps secret values out of stdout and stderr', async () => {
    const dataDir = await setupTestEnv('redi-logcheck-');
    const secret = 'sk-live-E2E-SECRET-XYZ-12345';
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: unknown,
    ) => {
      writes.push(String(chunk));
      return true;
    }) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(((
      chunk: unknown,
    ) => {
      writes.push(String(chunk));
      return true;
    }) as never);
    try {
      const { setSecret } = await import('../../src/server/secrets');
      const { callTool } = await import('../../src/server/tools/call');
      await setSecret('ai.api_key', secret);
      await callTool('get_settings', {}, { actor: 'user' });
      await callTool('list_mcp_tokens', {}, { actor: 'user' });
      expect(writes.join('')).not.toContain(secret);
    } finally {
      await teardownTestEnv(dataDir);
    }
  });
});

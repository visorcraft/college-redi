import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';

const ctorArgs: Array<Record<string, unknown>> = [];
const create = vi.fn(async () => ({
  choices: [{ message: { content: 'ok' } }],
  usage: {
    prompt_tokens: 12,
    completion_tokens: 3,
    total_tokens: 15,
  },
}));
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create } };

    constructor(args: Record<string, unknown>) {
      ctorArgs.push(args);
    }
  },
}));

import {
  hasAiConfiguration,
  AiDailyCapExceededError,
  AiNotConfiguredError,
  getAiClient,
  getAiUsageStatus,
} from '@/server/ai/client';
import { setSecret } from '@/server/secrets';
import { updateSettings } from '@/server/settings';

let env: TestEnv;
beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
  ctorArgs.length = 0;
  create.mockClear();
});
afterEach(() => env.cleanup());

describe('hasAiConfiguration', () => {
  it('requires the key, base URL, and model', () => {
    expect(hasAiConfiguration('sk-test', {
      base_url: 'https://ai.example/v1',
      model: 'model',
    })).toBe(true);
    expect(hasAiConfiguration(null, {
      base_url: 'https://ai.example/v1',
      model: 'model',
    })).toBe(false);
    expect(hasAiConfiguration('sk-test', {
      base_url: ' ',
      model: 'model',
    })).toBe(false);
  });
});

describe('getAiClient', () => {
  it('throws AiNotConfiguredError when no api key is stored', async () => {
    await expect(getAiClient()).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it('points the OpenAI SDK at the configured base URL with the stored key and defaults', async () => {
    await setSecret('ai.api_key', 'sk-unit-test');
    const handle = await getAiClient();
    expect(handle.model).toBe('gpt-5.6-luna');
    expect(handle.effort).toBe('medium');
    expect(ctorArgs[0]).toEqual({
      apiKey: 'sk-unit-test',
      baseURL: 'https://api.openai.com/v1',
      defaultHeaders: undefined,
      fetch: expect.any(Function),
      maxRetries: 1,
      timeout: 60_000,
    });
  });

  it('rejects provider redirects', async () => {
    await setSecret('ai.api_key', 'sk-unit-test');
    await getAiClient();
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await (ctorArgs[0]!.fetch as typeof fetch)('https://ai.example/v1', { redirect: 'follow' });
    expect(request).toHaveBeenCalledWith(
      'https://ai.example/v1',
      expect.objectContaining({ redirect: 'error' }),
    );
    request.mockRestore();
  });

  it('honors headers, counts calls, logs hashes and usage, and enforces the cap', async () => {
    await setSecret('ai.api_key', 'sk-unit-test');
    await updateSettings({
      ai: {
        daily_cap: 1,
        extra_headers: { 'x-provider-key': 'provider-value' },
      },
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { client } = await getAiClient();
    await client.chat.completions.create({
      model: 'test',
      messages: [{ role: 'user', content: 'PRIVATE PROMPT BODY' }],
    });

    expect(ctorArgs[0]).toMatchObject({
      defaultHeaders: { 'x-provider-key': 'provider-value' },
      maxRetries: 1,
      timeout: 60_000,
    });
    expect(await getAiUsageStatus()).toMatchObject({
      callsToday: 1,
      dailyCap: 1,
    });
    const logged = info.mock.calls.flat().join('');
    expect(logged).toContain('"prompt_hash"');
    expect(logged).toContain('"total_tokens":15');
    expect(logged).not.toContain('PRIVATE PROMPT BODY');

    await expect(client.chat.completions.create({
      model: 'test',
      messages: [{ role: 'user', content: 'second' }],
    })).rejects.toBeInstanceOf(AiDailyCapExceededError);
  });
});

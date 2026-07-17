import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';

const ctorArgs: Array<Record<string, unknown>> = [];
vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor(args: Record<string, unknown>) {
      ctorArgs.push(args);
    }
  },
}));

import { AiNotConfiguredError, getAiClient } from '@/server/ai/client';
import { setSecret } from '@/server/secrets';

let env: TestEnv;
beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
  ctorArgs.length = 0;
});
afterEach(() => env.cleanup());

describe('getAiClient', () => {
  it('throws AiNotConfiguredError when no api key is stored', async () => {
    await expect(getAiClient()).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it('points the OpenAI SDK at the configured base URL with the stored key and defaults', async () => {
    await setSecret('ai.api_key', 'sk-unit-test');
    const handle = await getAiClient();
    expect(handle.model).toBe('gpt-5.6-luna');
    expect(handle.effort).toBe('medium');
    expect(ctorArgs[0]).toEqual({ apiKey: 'sk-unit-test', baseURL: 'https://api.openai.com/v1' });
  });
});

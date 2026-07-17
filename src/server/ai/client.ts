import OpenAI from 'openai';
import { getSecret } from '../secrets';
import { getSettings } from '../settings';

export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI is not configured. Add an API key (ai.api_key) via the wizard or Settings.');
    this.name = 'AiNotConfiguredError';
  }
}

export interface AiClientHandle {
  client: OpenAI;
  model: string;
  effort: 'low' | 'medium' | 'high';
}

export async function getAiClient(): Promise<AiClientHandle> {
  const apiKey = await getSecret('ai.api_key');
  if (apiKey === null) throw new AiNotConfiguredError();
  const settings = await getSettings();
  return {
    client: new OpenAI({ apiKey, baseURL: settings.ai.base_url }),
    model: settings.ai.model,
    effort: settings.ai.effort,
  };
}

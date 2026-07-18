'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { TextField, PasswordField, SelectField, PrimaryButton } from '@/components/ui/forms';
import { TestConnectionButton } from '@/components/ui/TestConnectionButton';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export function AiStep({ settings, onComplete = async () => {}, busy = false, submitLabel = 'Save & continue' }: {
  settings: SettingsSnapshot; onComplete?: (patch?: Record<string, unknown>) => Promise<void>; busy?: boolean; submitLabel?: string;
}) {
  const ai = settings.ai ?? {};
  const [baseUrl, setBaseUrl] = useState(ai.base_url ?? 'https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(ai.model ?? 'gpt-5.6-luna');
  const [effort, setEffort] = useState(ai.effort ?? 'medium');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      if (apiKey) await apiFetch('/api/settings/secret', { method: 'PUT', body: { name: 'ai.api_key', value: apiKey } });
      await onComplete({ ai: { ...ai, base_url: baseUrl, model, effort } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">AI brain</h1>
      <TextField label="Base URL" value={baseUrl} onChange={setBaseUrl}
        hint="Any OpenAI-compatible endpoint works (OpenAI, OpenRouter, LM Studio, Ollama)." />
      <PasswordField label="API key" value={apiKey} onChange={setApiKey}
        hint="Stored encrypted; never shown again. Leave blank to keep the saved key." />
      <TextField label="Model" value={model} onChange={setModel} />
      <SelectField label="Effort" value={effort} onChange={(v) => setEffort(v as 'low' | 'medium' | 'high')}
        options={[
          { value: 'low', label: 'Low — fastest, cheapest' },
          { value: 'medium', label: 'Medium — balanced (recommended)' },
          { value: 'high', label: 'High — most thorough, most tokens' },
        ]} />
      <TestConnectionButton
        endpoint="/api/settings/test/ai"
        showRedi
        body={{
          base_url: baseUrl,
          model,
          effort,
          ...(apiKey ? { api_key: apiKey } : {}),
        }}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <PrimaryButton onClick={save} disabled={busy}>{submitLabel}</PrimaryButton>
    </div>
  );
}

import { z } from 'zod';
import { getSecret, setSecret } from '../secrets';
import { getSettings, updateSettings } from '../settings';
import { UpdateSettingsSchema } from '../../lib/schemas/settings';
import { defineTool, registerTool, type Tool } from './registry';

export const SECRET_NAMES = ['ai.api_key', 'imap.password', 'smtp.password', 'twilio.auth_token'] as const;

export const getSettingsTool: Tool = defineTool({
  name: 'get_settings',
  description:
    'Read all non-secret application settings. Secrets are reported as { set: true|false } and are never returned.',
  sideEffect: 'read',
  paramsSchema: z.object({}),
  handler: async () => {
    const settings = await getSettings();
    const secrets: Record<string, { set: boolean }> = {};
    for (const name of SECRET_NAMES) secrets[name] = { set: (await getSecret(name)) !== null };
    return { ...settings, secrets };
  },
});

export const updateSettingsTool: Tool = defineTool({
  name: 'update_settings',
  description:
    'Patch non-secret settings: timezone, quiet hours, notification prefs, IMAP/SMTP/Twilio config, AI config. Nested objects merge; arrays replace.',
  sideEffect: 'write',
  paramsSchema: UpdateSettingsSchema,
  handler: async (_ctx, params) => updateSettings(params),
});

export const setSecretTool: Tool = defineTool({
  name: 'set_secret',
  description:
    'Store or rotate an encrypted secret (ai.api_key, imap.password, smtp.password, twilio.auth_token). Write-only: the value is never returned or logged.',
  sideEffect: 'write',
  paramsSchema: z.object({ name: z.enum(SECRET_NAMES), value: z.string().min(1) }),
  handler: async (_ctx, params) => {
    await setSecret(params.name, params.value);
    return { ok: true, name: params.name, set: true };
  },
});

export function registerSettingsTools(): void {
  registerTool(getSettingsTool);
  registerTool(updateSettingsTool);
  registerTool(setSecretTool);
}

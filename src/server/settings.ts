import { lit, sqlExec, sqlRows } from './db/sql';
import { AppSettingsSchema, type AppSettings, type SettingsPatch } from '../lib/schemas/settings';
import { getConfig } from './config';

const ROW_ID = 1;
let updateTail: Promise<void> = Promise.resolve();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export async function getSettings(): Promise<AppSettings> {
  const row = (await sqlRows<{ payload: string }>(
    `SELECT payload FROM app_settings WHERE id = ${ROW_ID}`,
  ))[0];
  if (!row) {
    const fresh = AppSettingsSchema.parse({ timezone: getConfig().TZ ?? 'UTC' });
    await sqlExec(
      `INSERT INTO app_settings (id, payload, updated_at) VALUES (` +
      `${ROW_ID}, ${lit(JSON.stringify(fresh))}, ${lit(new Date())})`,
    );
    return fresh;
  }
  return AppSettingsSchema.parse(JSON.parse(row.payload));
}

export function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  // ponytail: one app process owns settings; use DB compare-and-swap if multi-app deployment arrives.
  const pending = updateTail.then(async () => {
    const merged = AppSettingsSchema.parse(deepMerge(await getSettings(), patch));
    await sqlExec(
      `UPDATE app_settings SET payload = ${lit(JSON.stringify(merged))}, ` +
      `updated_at = ${lit(new Date())} WHERE id = ${ROW_ID}`,
    );
    return merged;
  });
  updateTail = pending.then(() => undefined, () => undefined);
  return pending;
}

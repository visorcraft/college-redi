import { eq } from '@visorcraft/mongreldb-kit';
import { getKitDb } from './db/client';
import { appSettings } from '../../db/schema';
import { AppSettingsSchema, type AppSettings, type SettingsPatch } from '../lib/schemas/settings';

const ROW_ID = 1n;

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
  const db = await getKitDb();
  const rows = db.selectFrom(appSettings).where(eq(appSettings.id, ROW_ID)).executeSync();
  const row = rows[0];
  if (!row) {
    const fresh = AppSettingsSchema.parse({});
    db.insertInto(appSettings)
      .values({ id: ROW_ID, payload: JSON.stringify(fresh), updated_at: new Date().toISOString() })
      .executeSync();
    return fresh;
  }
  return AppSettingsSchema.parse(JSON.parse(row.payload as string));
}

export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  const db = await getKitDb();
  const merged = AppSettingsSchema.parse(deepMerge(await getSettings(), patch));
  db.updateTable(appSettings)
    .set({ payload: JSON.stringify(merged), updated_at: new Date().toISOString() })
    .where(eq(appSettings.id, ROW_ID))
    .executeSync();
  return merged;
}

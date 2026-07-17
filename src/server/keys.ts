import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from './config';

let cachedMasterKey: Buffer | null = null;

export async function getMasterKey(): Promise<Buffer> {
  if (cachedMasterKey) return cachedMasterKey;
  const cfg = getConfig();
  if (cfg.REDI_MASTER_KEY) {
    const raw = cfg.REDI_MASTER_KEY.trim();
    const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('REDI_MASTER_KEY must decode to 32 bytes (hex or base64).');
    cachedMasterKey = key;
    return key;
  }
  const keyPath = path.join(cfg.DATA_DIR, 'master.key');
  try {
    const existing = await readFile(keyPath);
    if (existing.length === 32) {
      await chmod(keyPath, 0o600);
      cachedMasterKey = existing;
      return existing;
    }
    throw new Error(`master keyfile ${keyPath} has ${existing.length} bytes, expected 32.`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const key = randomBytes(32);
  await mkdir(path.dirname(keyPath), { recursive: true });
  await writeFile(keyPath, key, { mode: 0o600 });
  await chmod(keyPath, 0o600);
  cachedMasterKey = key;
  return key;
}

export async function getSessionKey(): Promise<Buffer> {
  const cfg = getConfig();
  const base = cfg.SESSION_SECRET ? Buffer.from(cfg.SESSION_SECRET, 'utf8') : await getMasterKey();
  return createHash('sha256').update(Buffer.concat([base, Buffer.from(':redi-session')])).digest();
}

export function _resetKeysForTests(): void {
  cachedMasterKey = null;
}

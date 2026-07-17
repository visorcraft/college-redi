import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { eq } from '@visorcraft/mongreldb-kit';
import { getKitDb } from './db/client';
import { getMasterKey } from './keys';
import { secrets } from '../../db/schema';

export async function setSecret(name: string, value: string): Promise<void> {
  const db = await getKitDb();
  const key = await getMasterKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const sealed = Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const now = new Date().toISOString();
  const nameColumn = secrets.column('name');
  const existing = db.selectFrom(secrets).where(eq(nameColumn, name)).executeSync();
  if (existing.length === 0) {
    db.insertInto(secrets).values({ name, ciphertext: new Uint8Array(sealed), created_at: now, rotated_at: now }).executeSync();
  } else {
    db.updateTable(secrets).set({ ciphertext: new Uint8Array(sealed), rotated_at: now }).where(eq(nameColumn, name)).executeSync();
  }
}

export async function getSecret(name: string): Promise<string | null> {
  const db = await getKitDb();
  const rows = db.selectFrom(secrets).where(eq(secrets.column('name'), name)).executeSync();
  const row = rows[0];
  if (!row) return null;
  const buf = Buffer.from(row.ciphertext as Uint8Array);
  const decipher = createDecipheriv('aes-256-gcm', await getMasterKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString('utf8');
}

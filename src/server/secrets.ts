import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lit, sqlExec, sqlRows } from './db/sql';
import { getMasterKey } from './keys';

export async function setSecret(name: string, value: string): Promise<void> {
  const key = await getMasterKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const sealed = Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const now = new Date().toISOString();
  const existing = await sqlRows<{ name: string }>(
    `SELECT name FROM secrets WHERE name = ${lit(name)}`,
  );
  const blob = lit(`b64:${sealed.toString('base64url')}`);
  if (existing.length === 0) {
    await sqlExec(
      `INSERT INTO secrets (name, ciphertext, created_at, rotated_at) VALUES (` +
      `${lit(name)}, ${blob}, ${lit(now)}, ${lit(now)})`,
    );
  } else {
    await sqlExec(
      `UPDATE secrets SET ciphertext = ${blob}, rotated_at = ${lit(now)} ` +
      `WHERE name = ${lit(name)}`,
    );
  }
}

export async function getSecret(name: string): Promise<string | null> {
  const row = (await sqlRows<{ ciphertext_hex: string }>(
    `SELECT hex(ciphertext) AS ciphertext_hex FROM secrets ` +
    `WHERE name = ${lit(name)}`,
  ))[0];
  if (!row) return null;
  const stored = Buffer.from(row.ciphertext_hex, 'hex');
  const buf = stored.subarray(0, 4).toString() === 'b64:'
    ? Buffer.from(stored.subarray(4).toString(), 'base64url')
    : stored;
  const decipher = createDecipheriv('aes-256-gcm', await getMasterKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString('utf8');
}

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lit, sqlExec, sqlRows } from './db/sql';
import { getMasterKey } from './keys';

let insertLock = Promise.resolve();

export async function setSecret(name: string, value: string): Promise<void> {
  const encrypted = await encrypt(value);
  const existing = await sqlRows<{ name: string }>(
    `SELECT name FROM secrets WHERE name = ${lit(name)}`,
  );
  if (existing.length === 0) {
    await insertSecret(name, encrypted);
  } else {
    await sqlExec(
      `UPDATE secrets SET ciphertext = ${encrypted.blob}, rotated_at = ${lit(encrypted.now)} ` +
      `WHERE name = ${lit(name)}`,
    );
  }
}

export async function setSecretIfAbsent(
  name: string,
  value: string,
): Promise<boolean> {
  const previous = insertLock;
  let release = () => {};
  insertLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    if (await getSecret(name) !== null) return false;
    const encrypted = await encrypt(value);
    await insertSecret(name, encrypted);
    return true;
  } catch (error) {
    if (await getSecret(name) !== null) return false;
    throw error;
  } finally {
    release();
  }
}

async function encrypt(value: string): Promise<{ blob: string; now: string }> {
  const key = await getMasterKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const sealed = Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return {
    blob: lit(`b64:${sealed.toString('base64url')}`),
    now: new Date().toISOString(),
  };
}

async function insertSecret(
  name: string,
  encrypted: { blob: string; now: string },
): Promise<void> {
  await sqlExec(
    `INSERT INTO secrets (name, ciphertext, created_at, rotated_at) VALUES (` +
    `${lit(name)}, ${encrypted.blob}, ${lit(encrypted.now)}, ${lit(encrypted.now)})`,
  );
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

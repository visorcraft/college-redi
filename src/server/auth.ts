import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSessionKey } from './keys';
import { getSecret } from './secrets';

export const SESSION_COOKIE = 'redi_session';
export const CSRF_COOKIE = 'redi_csrf';
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

interface SessionPayload {
  v: 2;
  exp: number;
  pwd: string;
}

export async function createSessionToken(now: number = Date.now()): Promise<string> {
  return signSessionToken(await passwordVersion(), now);
}

export async function refreshSessionToken(
  passwordVersion: string,
  now: number = Date.now(),
): Promise<string> {
  return signSessionToken(passwordVersion, now);
}

async function signSessionToken(passwordVersion: string, now: number): Promise<string> {
  const payload = Buffer.from(JSON.stringify({
    v: 2,
    exp: now + SESSION_TTL_MS,
    pwd: passwordVersion,
  } satisfies SessionPayload)).toString('base64url');
  const sig = createHmac('sha256', await getSessionKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export async function readSessionToken(
  token: string | undefined,
  now: number = Date.now(),
): Promise<
  { valid: false }
  | { valid: true; passwordVersion: string }
> {
  if (!token) return { valid: false };
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return { valid: false };
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = createHmac('sha256', await getSessionKey()).update(payload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return { valid: false };
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionPayload;
    const valid = parsed.v === 2
      && typeof parsed.exp === 'number'
      && parsed.exp > now
      && typeof parsed.pwd === 'string'
      && parsed.pwd === await passwordVersion();
    return valid
      ? { valid: true, passwordVersion: parsed.pwd }
      : { valid: false };
  } catch {
    return { valid: false };
  }
}

async function passwordVersion(): Promise<string> {
  return createHash('sha256')
    .update(await getSecret('login.password_hash') ?? '')
    .digest('base64url');
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

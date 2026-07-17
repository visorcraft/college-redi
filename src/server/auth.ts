import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSessionKey } from './keys';

export const SESSION_COOKIE = 'redi_session';
export const CSRF_COOKIE = 'redi_csrf';
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

interface SessionPayload {
  v: 1;
  exp: number;
}

export async function createSessionToken(now: number = Date.now()): Promise<string> {
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: now + SESSION_TTL_MS } satisfies SessionPayload)).toString('base64url');
  const sig = createHmac('sha256', await getSessionKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export async function readSessionToken(token: string | undefined, now: number = Date.now()): Promise<{ valid: boolean }> {
  if (!token) return { valid: false };
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return { valid: false };
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = createHmac('sha256', await getSessionKey()).update(payload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return { valid: false };
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionPayload;
    return { valid: typeof parsed.exp === 'number' && parsed.exp > now };
  } catch {
    return { valid: false };
  }
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

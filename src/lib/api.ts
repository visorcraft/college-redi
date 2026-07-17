const CSRF_COOKIE = 'redi_csrf';
const CSRF_HEADER = 'x-csrf-token';

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export async function apiFetch(path: string, options: { method?: string; body?: unknown } = {}) {
  const csrf = readCookie(CSRF_COOKIE);
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(csrf ? { [CSRF_HEADER]: csrf } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data;
}

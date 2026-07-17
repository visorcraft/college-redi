'use client';

import { useEffect } from 'react';

export default function CsrfInit() {
  useEffect(() => {
    const original = window.fetch;
    window.fetch = (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ) => {
      try {
        const raw = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
        const url = new URL(raw, window.location.origin);
        if (
          url.origin === window.location.origin
          && url.pathname.startsWith('/api/')
        ) {
          const token = document.cookie
            .split('; ')
            .find((cookie) => cookie.startsWith('redi_csrf='))
            ?.split('=')[1];
          if (token) {
            const headers = new Headers(
              typeof input === 'object' && !(input instanceof URL)
                ? input.headers
                : undefined,
            );
            new Headers(init.headers).forEach((value, key) =>
              headers.set(key, value));
            headers.set('x-csrf-token', token);
            init = { ...init, headers };
          }
        }
      } catch {
        // Decoration must never block the request.
      }
      return original(input, init);
    };
    return () => {
      window.fetch = original;
    };
  }, []);
  return null;
}

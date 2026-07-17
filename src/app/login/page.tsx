'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

type Mode = 'loading' | 'setup' | 'login';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((me: { passwordSet: boolean }) => {
        if (!cancelled) setMode(me.passwordSet ? 'login' : 'setup');
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach the server. Is Redi running?');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (mode === 'setup' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, ...(mode === 'setup' ? { setupToken } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message ?? 'Something went wrong. Try again.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const isSetup = mode === 'setup';
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[#1F2D50] text-3xl" aria-hidden="true">
            ☁️
          </div>
          <h1 className="text-2xl font-bold text-[#1F2D50]">Redi</h1>
          <p className="mt-1 text-sm text-[#1F2D50]/70">
            {isSetup ? 'Create the password for your private Redi.' : 'Welcome back. Enter your password.'}
          </p>
        </div>
        {mode === 'loading' ? (
          <p className="text-center text-sm text-[#1F2D50]/60">Loading…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={isSetup ? 8 : 1}
                autoComplete={isSetup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-[#1F2D50]/20 px-3 py-2 outline-none focus:border-[#1F2D50] focus:ring-2 focus:ring-[#1F2D50]/20"
              />
            </div>
            {isSetup && (
              <div>
                <label htmlFor="setup-token" className="mb-1 block text-sm font-medium">
                  Setup token
                </label>
                <input
                  id="setup-token"
                  name="setup-token"
                  type="password"
                  required
                  autoComplete="off"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  className="w-full rounded-xl border border-[#1F2D50]/20 px-3 py-2 outline-none focus:border-[#1F2D50] focus:ring-2 focus:ring-[#1F2D50]/20"
                />
                <p className="mt-1 text-xs text-[#1F2D50]/60">
                  Find REDI_SETUP_TOKEN in DATA_DIR/.env.
                </p>
              </div>
            )}
            {isSetup && (
              <div>
                <label htmlFor="confirm" className="mb-1 block text-sm font-medium">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  name="confirm"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-xl border border-[#1F2D50]/20 px-3 py-2 outline-none focus:border-[#1F2D50] focus:ring-2 focus:ring-[#1F2D50]/20"
                />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[#1F2D50] py-2.5 font-semibold text-white transition hover:bg-[#2E416E] disabled:opacity-60"
            >
              {busy ? 'One moment…' : isSetup ? 'Create password' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

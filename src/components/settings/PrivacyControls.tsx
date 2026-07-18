'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

export function PrivacyControls() {
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function erase() {
    setDeleting(true);
    setError('');
    try {
      await apiFetch('/api/privacy/data', {
        method: 'DELETE',
        body: { password, confirm: phrase },
      });
      window.location.assign('/wizard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete data.');
      setDeleting(false);
    }
  }

  return (
    <div className="mt-8 border-t border-[#1F2D50]/15 pt-6">
      <h3 className="font-semibold text-[#1F2D50]">Your data</h3>
      <p className="mt-1 text-sm text-[#1F2D50]/70">
        Export a JSON copy, or permanently reset all Redi data. External backups are not changed.
      </p>
      <a
        href="/api/privacy/export"
        className="mt-3 inline-block rounded-xl border border-[#1F2D50]/30 px-3 py-2 text-sm text-[#1F2D50]"
      >
        Export my data
      </a>
      <div className="mt-5 max-w-md rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-semibold text-red-800">Permanent reset</p>
        <label className="mt-3 block text-sm text-red-900">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2"
          />
        </label>
        <label className="mt-3 block text-sm text-red-900">
          Type DELETE ALL MY DATA
          <input
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2"
          />
        </label>
        {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
        <button
          type="button"
          onClick={() => void erase()}
          disabled={deleting || !password || phrase !== 'DELETE ALL MY DATA'}
          className="mt-3 rounded-xl bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete all Redi data'}
        </button>
      </div>
    </div>
  );
}

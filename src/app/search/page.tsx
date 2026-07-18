'use client';

import { useState } from 'react';

interface SearchResult {
  kind: 'task' | 'course' | 'email' | 'notification';
  id: string;
  title: string;
  detail: string | null;
}

const hrefFor = (kind: SearchResult['kind']) => ({
  task: '/tasks',
  course: '/degree',
  email: '/email',
  notification: '/notifications',
})[kind];

export default function SearchPage() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('query') ?? '').trim();
    setMessage('Searching...');
    const response = await fetch(`/api/search?${new URLSearchParams({ query })}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setResults([]);
      setTotal(null);
      setMessage(body?.error?.message ?? 'Search failed.');
      return;
    }
    setResults(body.results);
    setTotal(body.total);
    setMessage(body.total === 0 ? 'No matches found.' : null);
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold text-[#1F2D50]">Search</h1>
      <form onSubmit={search} role="search" className="mt-4 flex gap-2">
        <label htmlFor="search-query" className="sr-only">Search Redi</label>
        <input
          id="search-query"
          name="query"
          type="search"
          required
          maxLength={200}
          placeholder="Tasks, courses, email, notifications"
          className="min-w-0 flex-1 rounded-xl border border-[#1F2D50]/20 bg-white px-3 py-2 text-[#1F2D50]"
        />
        <button type="submit" className="rounded-xl bg-[#1F2D50] px-4 py-2 font-semibold text-white">
          Search
        </button>
      </form>
      <p aria-live="polite" className="mt-3 text-sm text-[#1F2D50]/60">
        {message ?? (total === null ? 'Search across your Redi data.' : `${total} match${total === 1 ? '' : 'es'}`)}
      </p>
      <ul aria-label="Search results" className="mt-4 space-y-2">
        {results.map((result) => (
          <li key={`${result.kind}:${result.id}`}>
            <a href={hrefFor(result.kind)} className="block rounded-2xl bg-white p-4 shadow-sm">
              <span className="text-xs font-medium uppercase text-[#1F2D50]/50">{result.kind}</span>
              <p className="font-medium text-[#1F2D50]">{result.title}</p>
              {result.detail && <p className="mt-1 text-sm text-[#1F2D50]/70">{result.detail}</p>}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

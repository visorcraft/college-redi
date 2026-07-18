import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ callTool: vi.fn() }));
vi.mock('@/server/tools/call', () => ({ callTool: mocks.callTool }));

import { POST as schedule } from '@/app/api/notifications/route';
import { GET as search } from '@/app/api/search/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callTool.mockResolvedValue({});
});

describe('missing tool REST front doors', () => {
  it('passes reminder JSON to schedule_notification as the user', async () => {
    const body = {
      title: 'Email advisor',
      body: 'Ask about CS 201',
      scheduled_for: '2026-08-01T15:00:00.000Z',
    };
    const response = await schedule(new NextRequest('http://localhost/api/notifications', {
      method: 'POST',
      body: JSON.stringify(body),
    }));
    expect(response.status).toBe(201);
    expect(mocks.callTool).toHaveBeenCalledWith(
      'schedule_notification',
      body,
      { actor: 'user' },
    );
  });

  it('passes search query and limit to search_all as the user', async () => {
    await search(new NextRequest('http://localhost/api/search?query=advisor&limit=7'));
    expect(mocks.callTool).toHaveBeenCalledWith(
      'search_all',
      { query: 'advisor', limit: 7 },
      { actor: 'user' },
    );
  });
});

describe('human tool front doors', () => {
  it('links search from navigation and exposes accessible search controls', () => {
    expect(readFileSync('src/components/AppNav.tsx', 'utf8')).toContain("['Search', '/search']");
    const page = readFileSync('src/app/search/page.tsx', 'utf8');
    expect(page).toContain('role="search"');
    expect(page).toContain('aria-label="Search results"');
    expect(page).toContain('/api/search?');
  });

  it('schedules reminders with CSRF and accessible controls', () => {
    const page = readFileSync('src/app/notifications/page.tsx', 'utf8');
    expect(page).toContain('Schedule a reminder');
    expect(page).toContain("...csrfHeaders()");
    expect(page).toContain('type="datetime-local"');
    expect(page).toContain('<legend>Send through</legend>');
    expect(page).toContain('Choose at least one delivery channel.');
    expect(page).toContain('channels,');
  });
});

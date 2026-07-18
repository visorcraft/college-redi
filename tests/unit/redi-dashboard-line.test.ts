import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/tools/call', () => ({ callTool: vi.fn() }));

async function subject() {
  vi.resetModules();
  const mod = await import('../../src/server/chat/statusLine');
  const { callTool } = await import('../../src/server/tools/call');
  return {
    buildDashboardLine: mod.buildDashboardLine,
    callTool: callTool as unknown as ReturnType<typeof vi.fn>,
  };
}

describe('buildDashboardLine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports AI trouble first', async () => {
    const { buildDashboardLine, callTool } = await subject();
    callTool.mockImplementation(async (name: string) => {
      if (name === 'get_system_status') return { ai: { reachable: false } };
      return name === 'list_notifications'
        ? { notifications: [] }
        : { tasks: [] };
    });
    expect((await buildDashboardLine()).line).toContain('AI brain is offline');
    expect(callTool).toHaveBeenCalledWith(
      'get_system_status',
      { probe_connections: false, probe_ai: true },
      { actor: 'system' },
    );
  });

  it('leads with what is due today, then unread counts, then all-clear', async () => {
    const { buildDashboardLine, callTool } = await subject();
    const today = new Date().toISOString();
    callTool.mockImplementation(async (name: string) => {
      if (name === 'get_system_status') return { ai: { reachable: true } };
      if (name === 'list_tasks') {
        return {
          tasks: [
            {
              title: 'Pay tuition',
              due_at: today,
              status: 'pending',
            },
            { title: 'Later', due_at: null, status: 'pending' },
          ],
        };
      }
      return { notifications: [{}, {}, {}] };
    });
    const first = await buildDashboardLine();
    expect(first.line).toContain('1 thing due today');
    expect(first.unreadCount).toBe(3);

    callTool.mockImplementation(async (name: string) => {
      if (name === 'get_system_status') return { ai: { reachable: true } };
      if (name === 'list_tasks') return { tasks: [] };
      return { notifications: [{}, {}] };
    });
    expect((await buildDashboardLine()).line).toContain('2 unread updates');

    callTool.mockImplementation(async (name: string) => {
      if (name === 'get_system_status') return { ai: { reachable: true } };
      if (name === 'list_tasks') return { tasks: [] };
      return { notifications: [] };
    });
    expect((await buildDashboardLine()).line).toBe('All clear - nothing due today ☀️');
  });

  it('never throws when tools fail', async () => {
    const { buildDashboardLine, callTool } = await subject();
    callTool.mockRejectedValue(new Error('registry down'));
    expect((await buildDashboardLine()).line).toBe('All clear - nothing due today ☀️');
  });
});

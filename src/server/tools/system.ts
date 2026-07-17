import { KitDatabase } from '@visorcraft/mongreldb-kit';
import { z } from 'zod';
import { getConfig } from '../config';
import { getDb } from '../db/client';
import { getSecret } from '../secrets';
import { getSettings } from '../settings';
import { isSchedulerAlive } from '../scheduler';
import { sqlRows } from '../db/sql';
import { getAiUsageStatus } from '../ai/client';
import { defineTool, registerTool, type Tool } from './registry';

const searchAllParams = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(100).default(25),
});

type SearchRow = Record<string, unknown> & { id: string };
type SearchResult = {
  kind: 'task' | 'course' | 'email' | 'notification';
  id: string;
  title: string;
  detail: string | null;
};

const searchHit = (
  kind: SearchResult['kind'],
  row: SearchRow,
  title: string,
  detail: string | null,
): SearchResult => ({ kind, id: String(row.id), title, detail });

export const searchAllTool: Tool = defineTool({
  name: 'search_all',
  description: 'Case-insensitive search across tasks, courses, processed emails, and notifications.',
  sideEffect: 'read',
  paramsSchema: searchAllParams,
  handler: async (_context, params) => {
    const [tasks, courses, emails, notifications] = await Promise.all([
      sqlRows<SearchRow>('SELECT id, title, description, category, status FROM tasks'),
      sqlRows<SearchRow>('SELECT id, code, title, subject FROM courses'),
      sqlRows<SearchRow>(
        'SELECT id, subject, from_addr, summary, classification FROM emails_processed',
      ),
      sqlRows<SearchRow>('SELECT id, title, body, type, status FROM notifications'),
    ]);
    // ponytail: single-user in-memory search; add normalized indexed columns if row counts hurt.
    const query = params.query.toLocaleLowerCase();
    const matches = [
      ...tasks.map((row) => searchHit(
        'task',
        row,
        String(row.title),
        [row.description, row.category, row.status]
          .filter((value) => value !== null && value !== undefined)
          .map(String)
          .join(' · '),
      )),
      ...courses.map((row) => searchHit(
        'course',
        row,
        `${String(row.code)} ${String(row.title)}`,
        row.subject ? String(row.subject) : null,
      )),
      ...emails.map((row) => searchHit(
        'email',
        row,
        String(row.subject),
        [row.summary, row.from_addr, row.classification]
          .filter((value) => value !== null && value !== undefined)
          .map(String)
          .join(' · '),
      )),
      ...notifications.map((row) => searchHit(
        'notification',
        row,
        String(row.title),
        [row.body, row.type, row.status]
          .filter((value) => value !== null && value !== undefined)
          .map(String)
          .join(' · '),
      )),
    ].filter((row) =>
      `${row.title}\n${row.detail ?? ''}`.toLocaleLowerCase().includes(query));
    return { results: matches.slice(0, params.limit), total: matches.length };
  },
});

export const getSystemStatusTool: Tool = defineTool({
  name: 'get_system_status',
  description:
    'Health of the database, AI provider, IMAP/SMTP/Twilio channels, and scheduler, plus last poll times and notification backlog.',
  sideEffect: 'read',
  paramsSchema: z.object({}),
  handler: async () => {
    const cfg = getConfig();
    const settings = await getSettings();
    const db = await getDb();
    let dbStatus: Record<string, unknown>;
    try {
      if (db instanceof KitDatabase) {
        dbStatus = { mode: 'embedded', ok: true, tables: db.tableNames().length };
      } else {
        dbStatus = { mode: 'remote', ok: db.health().length > 0, tables: db.tableNames().length };
      }
    } catch (err) {
      dbStatus = { mode: cfg.DATABASE_MODE, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const pending = (await sqlRows<{ id: string }>(
      "SELECT id FROM notifications WHERE status = 'pending'",
    )).length;
    const [aiKey, imapPassword, smtpPassword, twilioToken] = await Promise.all([
      getSecret('ai.api_key'),
      getSecret('imap.password'),
      getSecret('smtp.password'),
      getSecret('twilio.auth_token'),
    ]);
    const aiUsage = await getAiUsageStatus();
    return {
      db: dbStatus,
      ai: {
        configured: aiKey !== null,
        base_url: settings.ai.base_url,
        model: settings.ai.model,
        effort: settings.ai.effort,
        calls_today: aiUsage.callsToday,
        daily_cap: aiUsage.dailyCap,
      },
      imap: {
        configured: settings.imap.host.length > 0 && imapPassword !== null,
        enabled: settings.imap.enabled,
        last_poll_at: settings.imap.last_poll_at,
        last_error: settings.imap.last_error,
      },
      smtp: { configured: settings.smtp.host.length > 0 && smtpPassword !== null, enabled: settings.smtp.enabled },
      twilio: {
        configured: settings.twilio.account_sid.length > 0 && twilioToken !== null,
        enabled: settings.twilio.enabled,
      },
      scheduler: { enabled: cfg.SCHEDULER_ENABLED, alive: isSchedulerAlive() },
      notifications: { pending },
    };
  },
});

export function registerSystemTools(): void {
  registerTool(getSystemStatusTool);
  registerTool(searchAllTool);
}

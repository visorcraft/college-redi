import { KitDatabase } from '@visorcraft/mongreldb-kit';
import { z } from 'zod';
import { getConfig } from '../config';
import { getDb } from '../db/client';
import { getSecret } from '../secrets';
import { getSettings } from '../settings';
import { isSchedulerAlive } from '../scheduler';
import { sqlRows } from '../db/sql';
import { defineTool, registerTool, type Tool } from './registry';

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
    return {
      db: dbStatus,
      ai: {
        configured: aiKey !== null,
        base_url: settings.ai.base_url,
        model: settings.ai.model,
        effort: settings.ai.effort,
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
}

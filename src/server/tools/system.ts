import { createHash } from 'node:crypto';
import { KitDatabase } from '@visorcraft/mongreldb-kit';
import nodemailer from 'nodemailer';
import twilio from 'twilio';
import { z } from 'zod';
import { getAiClient, hasAiConfiguration } from '../ai/client';
import { getConfig } from '../config';
import { getDb } from '../db/client';
import { getSecret } from '../secrets';
import { getSettings } from '../settings';
import { isSchedulerAlive } from '../scheduler';
import { sqlRows } from '../db/sql';
import { getAiUsageStatus } from '../ai/client';
import { defineTool, registerTool, type Tool } from './registry';
import { assertPublicNetworkHost } from '../network';

const searchAllParams = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(100).default(25),
});
const systemStatusParams = z.object({
  probe_connections: z.boolean().default(false),
  probe_ai: z.boolean().default(false),
});

type SearchRow = Record<string, unknown> & { id: string };
type SearchResult = {
  kind: 'task' | 'course' | 'email' | 'notification';
  id: string;
  title: string;
  detail: string | null;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function checkAi(configured: boolean) {
  if (!configured) return { reachable: false, error: 'not configured' };
  try {
    const { client, model } = await getAiClient();
    await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply ok.' }],
      max_completion_tokens: 1,
    }, { timeout: 3_000 });
    return { reachable: true };
  } catch (error) {
    return { reachable: false, error: errorMessage(error) };
  }
}

let recentHealth: {
  ai?: { key: string; checkedAt: number; value: Awaited<ReturnType<typeof checkAi>> };
  smtp?: { key: string; checkedAt: number; value: Awaited<ReturnType<typeof checkSmtp>> };
  twilio?: { key: string; checkedAt: number; value: Awaited<ReturnType<typeof checkTwilio>> };
} = {};
let aiProbe: {
  key: string;
  promise: Promise<Awaited<ReturnType<typeof checkAi>>>;
} | null = null;
const HEALTH_TTL_MS = 5 * 60_000;

const fingerprint = (value: string | null) =>
  value === null
    ? 'none'
    : createHash('sha256').update(value).digest('hex');

async function refreshAiHealth(configured: boolean, key: string) {
  if (aiProbe?.key !== key) {
    const promise = checkAi(configured).finally(() => {
      if (aiProbe?.promise === promise) aiProbe = null;
    });
    aiProbe = { key, promise };
  }
  return aiProbe.promise;
}

async function checkSmtp(
  settings: Awaited<ReturnType<typeof getSettings>>,
  password: string | null,
) {
  const smtp = settings.smtp;
  if (!smtp.host || !password) return { valid: false, error: 'not configured' };
  await assertPublicNetworkHost(smtp.host);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    auth: smtp.username ? { user: smtp.username, pass: password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  try {
    await transport.verify();
    return { valid: true };
  } catch (error) {
    return { valid: false, error: errorMessage(error) };
  } finally {
    transport.close();
  }
}

async function checkTwilio(
  settings: Awaited<ReturnType<typeof getSettings>>,
  token: string | null,
) {
  const accountSid = settings.twilio.account_sid;
  if (!accountSid || !token) return { valid: false, error: 'not configured' };
  try {
    await twilio(accountSid, token, { timeout: 10_000 })
      .api.accounts(accountSid).fetch();
    return { valid: true };
  } catch (error) {
    return { valid: false, error: errorMessage(error) };
  }
}

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
  paramsSchema: systemStatusParams,
  handler: async (_context, params) => {
    const cfg = getConfig();
    const settings = await getSettings();
    const db = await getDb();
    let dbStatus: Record<string, unknown>;
    try {
      if (db instanceof KitDatabase) {
        dbStatus = {
          mode: 'embedded',
          lock: 'held by this Redi process',
          ok: true,
          tables: db.tableNames().length,
        };
      } else {
        dbStatus = {
          mode: 'remote',
          lock: 'managed by MongrelDB daemon',
          ok: db.health().length > 0,
          tables: db.tableNames().length,
        };
      }
    } catch (err) {
      dbStatus = { mode: cfg.DATABASE_MODE, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const [pendingRows, emailDeliveryRows, smsDeliveryRows] = await Promise.all([
      sqlRows<{ n: number }>(
        "SELECT COUNT(*) AS n FROM notifications WHERE status = 'pending'",
      ),
      sqlRows<{
        channel: string;
        status: string;
        notification_status: string;
      }>(
        `SELECT h.channel, h.status, n.status AS notification_status ` +
        `FROM notification_history h JOIN notifications n ON n.id = h.notification_id ` +
        `WHERE h.channel = 'email' ORDER BY h.sent_at DESC LIMIT 1`,
      ),
      sqlRows<{
        channel: string;
        status: string;
        notification_status: string;
      }>(
        `SELECT h.channel, h.status, n.status AS notification_status ` +
        `FROM notification_history h JOIN notifications n ON n.id = h.notification_id ` +
        `WHERE h.channel = 'sms' ORDER BY h.sent_at DESC LIMIT 1`,
      ),
    ]);
    const pending = Number(pendingRows[0]?.n ?? 0);
    const latestDelivery = new Map([
      ['email', emailDeliveryRows[0]],
      ['sms', smsDeliveryRows[0]],
    ]);
    const deliveryFailed = (channel: 'email' | 'sms') => {
      const latest = latestDelivery.get(channel);
      return latest?.status === 'failed' && latest.notification_status === 'failed';
    };
    const [aiKey, imapPassword, smtpPassword, twilioToken] = await Promise.all([
      getSecret('ai.api_key'),
      getSecret('imap.password'),
      getSecret('smtp.password'),
      getSecret('twilio.auth_token'),
    ]);
    const healthKeys = {
      ai: `${fingerprint(aiKey)}:${settings.ai.base_url}:${settings.ai.model}`,
      smtp: `${fingerprint(smtpPassword)}:${settings.smtp.host}:${settings.smtp.port}:${settings.smtp.username}`,
      twilio: `${fingerprint(twilioToken)}:${settings.twilio.account_sid}`,
    };
    const aiConfigured = hasAiConfiguration(aiKey, settings.ai);
    const now = Date.now();
    if (params.probe_connections) {
      const [ai, smtp, twilioStatus] = await Promise.all([
        refreshAiHealth(aiConfigured, healthKeys.ai),
        checkSmtp(settings, smtpPassword),
        checkTwilio(settings, twilioToken),
      ]);
      recentHealth = {
        ai: { key: healthKeys.ai, checkedAt: Date.now(), value: ai },
        smtp: { key: healthKeys.smtp, checkedAt: Date.now(), value: smtp },
        twilio: { key: healthKeys.twilio, checkedAt: Date.now(), value: twilioStatus },
      };
    } else if (
      (params.probe_ai || _context.actor.startsWith('mcp:'))
      && (
        recentHealth.ai?.key !== healthKeys.ai
        || now - recentHealth.ai.checkedAt >= HEALTH_TTL_MS
      )
    ) {
      const ai = await refreshAiHealth(aiConfigured, healthKeys.ai);
      recentHealth.ai = {
        key: healthKeys.ai,
        checkedAt: Date.now(),
        value: ai,
      };
    }
    const aiUsage = await getAiUsageStatus();
    const cached = {
      ai: recentHealth.ai?.key === healthKeys.ai
        && now - recentHealth.ai.checkedAt < HEALTH_TTL_MS
        ? recentHealth.ai.value
        : undefined,
      smtp: recentHealth.smtp?.key === healthKeys.smtp
        && now - recentHealth.smtp.checkedAt < HEALTH_TTL_MS
        ? recentHealth.smtp.value
        : undefined,
      twilio: recentHealth.twilio?.key === healthKeys.twilio
        && now - recentHealth.twilio.checkedAt < HEALTH_TTL_MS
        ? recentHealth.twilio.value
        : undefined,
    };
    return {
      db: dbStatus,
      ai: {
        configured: aiConfigured,
        base_url: settings.ai.base_url,
        model: settings.ai.model,
        effort: settings.ai.effort,
        calls_today: aiUsage.callsToday,
        daily_cap: aiUsage.dailyCap,
        ...cached.ai,
      },
      imap: {
        configured: settings.imap.host.length > 0 && imapPassword !== null,
        enabled: settings.imap.enabled,
        last_poll_at: settings.imap.last_poll_at,
        last_error: settings.imap.last_error,
      },
      smtp: {
        configured: settings.smtp.host.length > 0 && smtpPassword !== null,
        enabled: settings.smtp.enabled,
        ...cached.smtp,
        last_delivery_error: deliveryFailed('email')
          ? 'A scheduled email failed after all retries.'
          : null,
      },
      twilio: {
        configured: settings.twilio.account_sid.length > 0 && twilioToken !== null,
        enabled: settings.twilio.enabled,
        ...cached.twilio,
        last_delivery_error: deliveryFailed('sms')
          ? 'A scheduled text message failed after all retries.'
          : null,
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

import { getSettings, updateSettings } from '../settings';
import { callTool } from '../tools/call';
import { triageMessages, type TriageOutcome, type TriageResult } from '../ai/triage';
import { createImapSource, type FetchedEmail, type ImapSource } from './imapClient';
import * as store from './store';

export interface PipelineDeps {
  source?: ImapSource;
  triage?: (
    messages: Array<{ from: string; subject: string; date: string; bodyText: string }>,
    opts: { timezone: string; now: Date },
  ) => Promise<TriageOutcome[]>;
  now?: () => Date;
  actor?: string;
}

export interface PipelineResult {
  configured: boolean;
  fetched: number;
  skipped: number;
  junk: number;
  informational: number;
  actionable: number;
  unprocessed: number;
  summaries: Array<{
    id: string;
    subject: string;
    classification: string;
    summary: string | null;
  }>;
}

/** Match an exact address or a domain, including subdomains. */
export function matchSenderRule(pattern: string, fromAddr: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  const from = fromAddr.trim().toLowerCase();
  if (!normalizedPattern || !from.includes('@')) return false;
  if (normalizedPattern.includes('@')) return from === normalizedPattern;
  const domain = from.slice(from.indexOf('@') + 1);
  return domain === normalizedPattern || domain.endsWith(`.${normalizedPattern}`);
}

export function categoryForEventType(type: string): string {
  if (type === 'registration') return 'registration';
  if (type === 'payment') return 'payment';
  if (type === 'appointment') return 'advising';
  return 'other';
}

async function patchImap(patch: Record<string, unknown>): Promise<void> {
  await updateSettings({ imap: patch });
}

interface PendingAi {
  msg: FetchedEmail;
  messageId: string;
  existingId: string | null;
}

export async function dismissLinkedTasksForEmail(
  emailId: string,
  actor: string,
): Promise<void> {
  const taskIds = new Set(
    (await store.listExtractedEventsForEmail(emailId))
      .map((event) => event.task_id)
      .filter((id): id is string => id !== null),
  );
  for (const id of taskIds) {
    await callTool('dismiss_task', { id }, { actor });
  }
}

/** Persist one triaged message and any events, tasks, and summary notification. */
export async function recordTriageResult(
  base: {
    id: string | null;
    mailbox: string;
    uid: number;
    uidvalidity: number;
    message_id: string;
    from_addr: string;
    subject: string;
    received_at: string;
  },
  result: TriageResult,
  deps: { now: Date; actor: string; autoAccept: boolean },
): Promise<{ id: string; notified: boolean }> {
  const id = base.id ?? await store.insertProcessedEmail({
    mailbox: base.mailbox,
    uid: base.uid,
    uidvalidity: base.uidvalidity,
    message_id: base.message_id,
    from_addr: base.from_addr,
    subject: base.subject,
    received_at: base.received_at,
    classification: 'unprocessed',
    summary: null,
    extracted_count: 0,
    notified: false,
    processed_at: null,
  });
  const persist = async () => {
    const shouldAccept = (confidence: number, dueAt: string | null) =>
      deps.autoAccept && confidence >= 0.9 && dueAt !== null;

    if (base.id) {
      await store.cancelPendingEmailSummaries(id);
      await dismissLinkedTasksForEmail(id, deps.actor);
      await store.deleteExtractedEventsForEmail(id);
    }

    const events: store.ExtractedEventRow[] = [];
    for (const event of result.events) {
      const accepted = shouldAccept(event.confidence, event.due_at);
      let taskId: string | null = null;
      if (accepted) {
        const task = await callTool('create_task', {
          title: event.title,
          description: `From email "${base.subject}" (${base.from_addr}): ${result.summary}`,
          category: categoryForEventType(event.event_type),
          due_at: event.due_at,
          source: 'email',
          source_email_id: id,
        }, { actor: deps.actor }) as { id: string };
        taskId = task.id;
      }
      const eventId = crypto.randomUUID();
      const createdAt = deps.now.toISOString();
      await store.insertExtractedEvent({
        id: eventId,
        email_id: id,
        title: event.title,
        event_type: event.event_type,
        due_at: event.due_at,
        confidence: event.confidence,
        status: accepted ? 'accepted' : 'pending_review',
        task_id: taskId,
        created_at: createdAt,
      });
      events.push({
        id: eventId,
        email_id: id,
        title: event.title,
        event_type: event.event_type,
        due_at: event.due_at,
        confidence: event.confidence,
        status: accepted ? 'accepted' : 'pending_review',
        task_id: taskId,
        created_at: createdAt,
      });
    }

    let notified = false;
    if (result.classification === 'actionable') {
      const { forwardActionableSummary } = await import('./forward');
      await forwardActionableSummary(
        {
          id,
          subject: base.subject,
          from_addr: base.from_addr,
          summary: result.summary,
        },
        events,
        result.importance,
        deps.now,
      );
      notified = true;
    }
    await store.updateProcessedEmail(id, {
      classification: result.classification,
      summary: result.summary,
      extracted_count: result.events.length,
      notified,
      processed_at: deps.now.toISOString(),
    });
    return { id, notified };
  };
  return store.withTransaction(persist);
}

const emptyResult = (): PipelineResult => ({
  configured: true,
  fetched: 0,
  skipped: 0,
  junk: 0,
  informational: 0,
  actionable: 0,
  unprocessed: 0,
  summaries: [],
});

/** Poll and triage once. Cursor advances only past fully processed messages. */
export async function runEmailPipeline(deps: PipelineDeps = {}): Promise<PipelineResult> {
  const now = deps.now?.() ?? new Date();
  const actor = deps.actor ?? 'system';
  const settings = await getSettings();
  const imap = settings.imap;
  if (!imap.enabled || !imap.host) return { ...emptyResult(), configured: false };

  const mailbox = imap.mailbox ?? 'INBOX';
  const source = deps.source ?? createImapSource();
  const triage = deps.triage ?? triageMessages;
  const result = emptyResult();
  const batch = await source.fetchNew(
    mailbox,
    Number(imap.last_uid ?? 0),
    imap.uidvalidity ?? null,
  );
  const rules = await store.listSenderRules();
  let cursor = imap.uidvalidity === batch.uidvalidity ? Number(imap.last_uid ?? 0) : 0;
  const pendingAi: PendingAi[] = [];

  async function markUnprocessed(pending: PendingAi): Promise<void> {
    if (pending.existingId) return;
    pending.existingId = await store.insertProcessedEmail({
      mailbox,
      uid: pending.msg.uid,
      uidvalidity: batch.uidvalidity,
      message_id: pending.messageId,
      from_addr: pending.msg.from,
      subject: pending.msg.subject,
      received_at: pending.msg.receivedAt.toISOString(),
      classification: 'unprocessed',
      summary: null,
      extracted_count: 0,
      notified: false,
      processed_at: now.toISOString(),
    });
  }

  async function flushAi(): Promise<boolean> {
    if (pendingAi.length === 0) return true;
    let outcomes: TriageOutcome[];
    try {
      outcomes = await triage(
        pendingAi.map((pending) => ({
          from: pending.msg.from,
          subject: pending.msg.subject,
          date: pending.msg.receivedAt.toISOString(),
          bodyText: pending.msg.text,
        })),
        { timezone: settings.timezone ?? 'UTC', now },
      );
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'email triage failed',
        error_name: error instanceof Error ? error.name : 'UnknownError',
      }));
      outcomes = pendingAi.map(() => ({ ok: false as const, error: 'triage call failed' }));
    }

    for (let index = 0; index < pendingAi.length; index += 1) {
      const pending = pendingAi[index];
      const outcome = outcomes[index] ?? { ok: false as const, error: 'no outcome' };
      if (!outcome.ok) {
        for (let remaining = index; remaining < pendingAi.length; remaining += 1) {
          await markUnprocessed(pendingAi[remaining]);
          result.unprocessed += 1;
        }
        pendingAi.length = 0;
        return false;
      }
      const persisted = await recordTriageResult({
        id: pending.existingId,
        mailbox,
        uid: pending.msg.uid,
        uidvalidity: batch.uidvalidity,
        message_id: pending.messageId,
        from_addr: pending.msg.from,
        subject: pending.msg.subject,
        received_at: pending.msg.receivedAt.toISOString(),
      }, outcome.result, {
        now,
        actor,
        autoAccept: imap.auto_accept_events === true,
      });
      result[outcome.result.classification] += 1;
      if (outcome.result.classification !== 'junk') {
        result.summaries.push({
          id: persisted.id,
          subject: pending.msg.subject,
          classification: outcome.result.classification,
          summary: outcome.result.summary,
        });
      }
      cursor = Math.max(cursor, pending.msg.uid);
    }
    pendingAi.length = 0;
    return true;
  }

  let stopped = false;
  for (const message of batch.messages) {
    result.fetched += 1;
    const messageId = message.messageId
      || `no-message-id:${mailbox}:${batch.uidvalidity}:${message.uid}`;
    let existing = await store.findProcessedByUid(mailbox, batch.uidvalidity, message.uid);
    if (existing && existing.classification !== 'unprocessed') {
      result.skipped += 1;
      cursor = Math.max(cursor, message.uid);
      continue;
    }
    if (!existing) {
      const duplicate = await store.findProcessedByMessageId(messageId);
      if (duplicate && duplicate.classification !== 'unprocessed') {
        result.skipped += 1;
        cursor = Math.max(cursor, message.uid);
        continue;
      }
      if (duplicate) {
        await store.updateProcessedEmail(duplicate.id, {
          mailbox,
          uid: message.uid,
          uidvalidity: batch.uidvalidity,
        });
        existing = {
          ...duplicate,
          mailbox,
          uid: message.uid,
          uidvalidity: batch.uidvalidity,
        };
      }
    }

    const rule = rules.find((candidate) => matchSenderRule(candidate.pattern, message.from));
    if (rule?.action === 'junk') {
      const id = existing?.id ?? await store.insertProcessedEmail({
        mailbox,
        uid: message.uid,
        uidvalidity: batch.uidvalidity,
        message_id: messageId,
        from_addr: message.from,
        subject: message.subject,
        received_at: message.receivedAt.toISOString(),
        classification: 'junk',
        summary: null,
        extracted_count: 0,
        notified: false,
        processed_at: null,
      });
      await store.updateProcessedEmail(id, {
        classification: 'junk',
        summary: null,
        extracted_count: 0,
        notified: false,
        processed_at: now.toISOString(),
      });
      result.junk += 1;
      cursor = Math.max(cursor, message.uid);
      continue;
    }
    if (rule?.action === 'important') {
      const summary = `Important sender - ${message.subject}`;
      const persisted = await recordTriageResult({
        id: existing?.id ?? null,
        mailbox,
        uid: message.uid,
        uidvalidity: batch.uidvalidity,
        message_id: messageId,
        from_addr: message.from,
        subject: message.subject,
        received_at: message.receivedAt.toISOString(),
      }, {
        classification: 'actionable',
        summary,
        importance: 'urgent',
        events: [],
        rationale: 'sender rule',
      }, { now, actor, autoAccept: false });
      result.actionable += 1;
      result.summaries.push({
        id: persisted.id,
        subject: message.subject,
        classification: 'actionable',
        summary,
      });
      cursor = Math.max(cursor, message.uid);
      continue;
    }

    pendingAi.push({
      msg: message,
      messageId,
      existingId: existing?.id ?? null,
    });
    if (pendingAi.length >= 10 && !(await flushAi())) {
      stopped = true;
      break;
    }
  }
  if (!stopped) await flushAi();

  await patchImap({
    last_uid: cursor,
    uidvalidity: batch.uidvalidity,
    last_poll_at: now.toISOString(),
    last_error: null,
    backoff_step: 0,
    next_poll_after: null,
  });
  return result;
}

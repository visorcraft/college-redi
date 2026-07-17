import { z } from 'zod';
import { triageMessages } from '../ai/triage';
import { createImapSource } from '../email/imapClient';
import {
  categoryForEventType,
  dismissLinkedTasksForEmail,
  recordTriageResult,
  runEmailPipeline,
} from '../email/pipeline';
import * as store from '../email/store';
import { getSettings } from '../settings';
import { ConflictError, NotFoundError, ToolError } from './errors';
import { defineTool, type Tool } from './registry';

export const checkEmailNowParams = z.object({});
export const listProcessedEmailsParams = z.object({
  classification: z.enum(['junk', 'informational', 'actionable', 'unprocessed']).optional(),
  since: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const getEmailDetailParams = z.object({ id: z.string().min(1) });
export const reclassifyEmailParams = z.object({
  id: z.string().min(1),
  classification: z.enum(['junk', 'informational', 'actionable']),
});
export const addSenderRuleParams = z.object({
  pattern: z.string().min(3).max(320),
  action: z.enum(['junk', 'important']),
});
export const removeSenderRuleParams = z.object({
  id: z.string().min(1),
  confirm: z.literal(true),
});
export const listSenderRulesParams = z.object({});
export const listExtractedEventsParams = z.object({
  status: z.enum(['pending_review', 'accepted', 'dismissed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const acceptEventParams = z.object({
  id: z.string().min(1),
  create_task: z.boolean().default(true),
  title: z.string().min(1).max(300).optional(),
  due_at: z.string().nullable().optional(),
  category: z.enum([
    'transcript',
    'vaccine',
    'financial_aid',
    'housing',
    'advising',
    'registration',
    'payment',
    'other',
  ]).optional(),
});
export const dismissEventParams = z.object({ id: z.string().min(1) });

const check_email_now = defineTool({
  name: 'check_email_now',
  description: 'Run one IMAP poll and AI triage cycle now.',
  sideEffect: 'write',
  paramsSchema: checkEmailNowParams,
  handler: (context) => runEmailPipeline({ actor: context.actor }),
});

const list_processed_emails = defineTool({
  name: 'list_processed_emails',
  description: 'List processed college emails with classification and summary.',
  sideEffect: 'read',
  paramsSchema: listProcessedEmailsParams,
  handler: (_context, params) => store.listProcessedEmails(params),
});

const get_email_detail = defineTool({
  name: 'get_email_detail',
  description: 'Get one processed email and its extracted events.',
  sideEffect: 'read',
  paramsSchema: getEmailDetailParams,
  handler: async (_context, params) => {
    const email = await store.getProcessedEmail(params.id);
    if (!email) throw new NotFoundError(`email ${params.id} not found`);
    return { email, events: await store.listExtractedEventsForEmail(email.id) };
  },
});

const reclassify_email = defineTool({
  name: 'reclassify_email',
  description: 'Override an email classification and re-run extraction.',
  sideEffect: 'write',
  paramsSchema: reclassifyEmailParams,
  handler: async (context, params) => {
    const row = await store.getProcessedEmail(params.id);
    if (!row) throw new NotFoundError(`email ${params.id} not found`);
    if (params.classification === 'junk') {
      await store.withTransaction(async () => {
        await dismissLinkedTasksForEmail(row.id, context.actor);
        await store.deleteExtractedEventsForEmail(row.id);
        await store.updateProcessedEmail(row.id, {
          classification: 'junk',
          summary: null,
          extracted_count: 0,
        });
      });
      return { email: await store.getProcessedEmail(row.id), events: [] };
    }
    const message = await createImapSource().fetchByUid(row.mailbox, row.uid);
    if (!message) throw new NotFoundError('message is no longer available on the IMAP server');
    if (message.messageId && row.message_id && message.messageId !== row.message_id) {
      throw new ToolError(
        'conflict',
        'mailbox UIDVALIDITY changed since this email was processed; cannot safely re-fetch it',
        409,
      );
    }
    const settings = await getSettings();
    const [outcome] = await triageMessages([
      {
        from: message.from,
        subject: message.subject,
        date: message.receivedAt.toISOString(),
        bodyText: message.text,
      },
    ], { timezone: settings.timezone ?? 'UTC', now: new Date() });
    if (!outcome?.ok) throw new ToolError('internal', `re-triage failed: ${outcome?.error ?? 'no result'}`, 500);
    await recordTriageResult({
      id: row.id,
      mailbox: row.mailbox,
      uid: row.uid,
      uidvalidity: row.uidvalidity,
      message_id: row.message_id,
      from_addr: row.from_addr,
      subject: row.subject,
      received_at: row.received_at,
    }, { ...outcome.result, classification: params.classification }, {
      now: new Date(),
      actor: context.actor,
      autoAccept: settings.imap.auto_accept_events === true,
    });
    return {
      email: await store.getProcessedEmail(row.id),
      events: await store.listExtractedEventsForEmail(row.id),
    };
  },
});

const add_sender_rule = defineTool({
  name: 'add_sender_rule',
  description: 'Force a sender address or domain to junk or important.',
  sideEffect: 'write',
  paramsSchema: addSenderRuleParams,
  handler: async (_context, params) => {
    const pattern = params.pattern.trim().toLowerCase();
    if (await store.findSenderRuleByPattern(pattern)) {
      throw new ConflictError(`sender rule for ${pattern} already exists`);
    }
    return { rule: await store.insertSenderRule({ pattern, action: params.action }) };
  },
});

const remove_sender_rule = defineTool({
  name: 'remove_sender_rule',
  description: 'Remove a sender rule. Requires confirm: true.',
  sideEffect: 'destructive',
  paramsSchema: removeSenderRuleParams,
  handler: async (_context, params) => {
    if (!(await store.deleteSenderRule(params.id))) {
      throw new NotFoundError(`sender rule ${params.id} not found`);
    }
    return { removed: true };
  },
});

const list_sender_rules = defineTool({
  name: 'list_sender_rules',
  description: 'List sender classification rules.',
  sideEffect: 'read',
  paramsSchema: listSenderRulesParams,
  handler: async () => ({ rules: await store.listSenderRules() }),
});

const list_extracted_events = defineTool({
  name: 'list_extracted_events',
  description: 'List extracted email events and review state.',
  sideEffect: 'read',
  paramsSchema: listExtractedEventsParams,
  handler: async (_context, params) => ({ events: await store.listExtractedEvents(params) }),
});

const accept_event = defineTool({
  name: 'accept_event',
  description: 'Accept an extracted event and optionally create a task.',
  sideEffect: 'write',
  paramsSchema: acceptEventParams,
  handler: async (context, params) => {
    const event = await store.getExtractedEvent(params.id);
    if (!event) throw new NotFoundError(`event ${params.id} not found`);
    if (event.status === 'dismissed') {
      throw new ToolError('conflict', 'event was dismissed; cannot accept it', 409);
    }
    let taskId = event.task_id;
    if (params.create_task && !taskId) {
      const email = await store.getProcessedEmail(event.email_id);
      const { callTool } = await import('./call');
      const task = await callTool('create_task', {
        title: params.title ?? event.title,
        description: email
          ? `From email "${email.subject}" (${email.from_addr})${email.summary ? `: ${email.summary}` : ''}`
          : null,
        category: params.category ?? categoryForEventType(event.event_type),
        due_at: params.due_at !== undefined ? params.due_at : event.due_at,
        source: 'email',
        source_email_id: event.email_id,
      }, context) as { id: string };
      taskId = task.id;
    }
    await store.updateExtractedEvent(event.id, {
      status: 'accepted',
      ...(params.title ? { title: params.title } : {}),
      ...(params.due_at !== undefined ? { due_at: params.due_at } : {}),
      task_id: taskId,
    });
    return { event: await store.getExtractedEvent(event.id) };
  },
});

const dismiss_event = defineTool({
  name: 'dismiss_event',
  description: 'Dismiss an extracted event and any linked task.',
  sideEffect: 'write',
  paramsSchema: dismissEventParams,
  handler: async (context, params) => {
    const event = await store.getExtractedEvent(params.id);
    if (!event) throw new NotFoundError(`event ${params.id} not found`);
    await store.updateExtractedEvent(event.id, { status: 'dismissed' });
    if (event.task_id) {
      const { callTool } = await import('./call');
      await callTool('dismiss_task', { id: event.task_id }, context).catch(() => undefined);
    }
    return { event: await store.getExtractedEvent(event.id) };
  },
});

export const emailTools = [
  check_email_now,
  list_processed_emails,
  get_email_detail,
  reclassify_email,
  add_sender_rule,
  remove_sender_rule,
  list_sender_rules,
  list_extracted_events,
  accept_event,
  dismiss_event,
] as Tool[];

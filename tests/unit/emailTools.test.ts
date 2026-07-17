import { beforeAll, describe, expect, it, vi } from 'vitest';
import { freshEmailTestDb } from '../helpers/emailTestDb';

vi.mock('../../src/server/notify/engine', () => ({
  enqueueNotification: vi.fn(async () => 'n-1'),
}));
vi.mock('../../src/server/tools/call', () => ({
  callTool: vi.fn(async () => ({ id: 'task-9' })),
}));
vi.mock('../../src/server/ai/triage', () => ({
  triageMessages: vi.fn(async () => [{
    ok: true,
    result: {
      classification: 'actionable',
      summary: 'Your registration closes July 24 at 5pm ET.',
      importance: 'urgent',
      events: [{
        title: 'Registration closes',
        event_type: 'registration',
        due_at: '2026-07-24T21:00:00.000Z',
        confidence: 0.95,
      }],
      rationale: 'deadline',
    },
  }]),
}));
vi.mock('../../src/server/email/imapClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/server/email/imapClient')>();
  return {
    ...original,
    createImapSource: () => ({
      fetchNew: async () => ({ uidvalidity: 1, rescan: false, messages: [] }),
      fetchByUid: async () => ({
        uid: 7,
        messageId: '<reg-2026-041@stateu.edu>',
        from: 'registrar@stateu.edu',
        subject: 'Registration for Fall 2026 closes Friday',
        receivedAt: new Date('2026-07-14T13:30:00.000Z'),
        text: 'Your registration window closes July 24 at 5pm ET.',
      }),
    }),
  };
});
vi.mock('../../src/server/email/pipeline', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/server/email/pipeline')>();
  return {
    ...original,
    runEmailPipeline: vi.fn(async () => ({
      configured: true,
      fetched: 2,
      skipped: 0,
      junk: 1,
      informational: 1,
      actionable: 0,
      unprocessed: 0,
      summaries: [{
        id: 'x',
        subject: 'Library hours',
        classification: 'informational',
        summary: 'Open 8-6.',
      }],
    })),
  };
});

let tools: typeof import('../../src/server/tools/email');
let store: typeof import('../../src/server/email/store');
let settings: typeof import('../../src/server/settings');
let callMock: { callTool: ReturnType<typeof vi.fn> };
let engineMock: { enqueueNotification: ReturnType<typeof vi.fn> };
const context = { actor: 'user' };

const invoke = async <T>(name: string, params: unknown): Promise<T> => {
  const tool = tools.emailTools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return await tool.handler(context, tool.paramsSchema.parse(params)) as T;
};

beforeAll(async () => {
  await freshEmailTestDb();
  tools = await import('../../src/server/tools/email');
  store = await import('../../src/server/email/store');
  settings = await import('../../src/server/settings');
  callMock = await import('../../src/server/tools/call') as unknown as typeof callMock;
  engineMock = await import('../../src/server/notify/engine') as unknown as typeof engineMock;
  await settings.updateSettings({
    imap: { host: 'imap.stateu.edu', enabled: true, auto_accept_events: true },
    timezone: 'UTC',
  });
});

describe('sender rule tools', () => {
  it('adds, lists, rejects duplicates, and removes with confirmation', async () => {
    const added = await invoke<{ rule: { id: string; pattern: string } }>(
      'add_sender_rule',
      { pattern: 'Deals@CampusStore.example', action: 'junk' },
    );
    expect(added.rule.pattern).toBe('deals@campusstore.example');
    expect((await invoke<{ rules: unknown[] }>('list_sender_rules', {})).rules).toHaveLength(1);
    await expect(invoke('add_sender_rule', {
      pattern: 'deals@campusstore.example',
      action: 'junk',
    })).rejects.toThrow('already exists');
    expect(tools.removeSenderRuleParams.safeParse({ id: added.rule.id }).success).toBe(false);
    expect(await invoke('remove_sender_rule', {
      id: added.rule.id,
      confirm: true,
    })).toEqual({ removed: true });
    expect((await invoke<{ rules: unknown[] }>('list_sender_rules', {})).rules).toHaveLength(0);
  });
});

describe('processed email tools', () => {
  it('returns counts and summaries from a manual check', async () => {
    const result = await invoke<{
      configured: boolean;
      fetched: number;
      junk: number;
      informational: number;
      summaries: Array<{ summary: string }>;
    }>('check_email_now', {});
    expect(result).toMatchObject({
      configured: true,
      fetched: 2,
      junk: 1,
      informational: 1,
    });
    expect(result.summaries[0]?.summary).toBe('Open 8-6.');
  });

  it('filters processed emails and joins detail events', async () => {
    const emailId = await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 5,
      uidvalidity: 1,
      message_id: '<d@x>',
      from_addr: 'registrar@stateu.edu',
      subject: 'Registration closes',
      received_at: '2026-07-17T09:00:00.000Z',
      classification: 'actionable',
      summary: 'Closes Friday.',
      extracted_count: 1,
      notified: true,
      processed_at: '2026-07-17T09:01:00.000Z',
    });
    await store.insertExtractedEvent({
      email_id: emailId,
      title: 'Registration closes',
      event_type: 'registration',
      due_at: '2026-07-24T21:00:00.000Z',
      confidence: 0.95,
      status: 'pending_review',
      task_id: null,
    });
    await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 6,
      uidvalidity: 1,
      message_id: '<e@x>',
      from_addr: 'deals@x.example',
      subject: 'Promo',
      received_at: '2026-07-10T09:00:00.000Z',
      classification: 'junk',
      summary: null,
      extracted_count: 0,
      notified: false,
      processed_at: null,
    });
    const all = await invoke<{ total: number }>('list_processed_emails', {});
    expect(all.total).toBe(2);
    const actionable = await invoke<{ emails: Array<{ subject: string }> }>(
      'list_processed_emails',
      { classification: 'actionable' },
    );
    expect(actionable.emails.map((email) => email.subject)).toEqual(['Registration closes']);
    const recent = await invoke<{ total: number }>(
      'list_processed_emails',
      { since: '2026-07-16T00:00:00.000Z' },
    );
    expect(recent.total).toBe(1);
    const detail = await invoke<{
      email: { summary: string };
      events: Array<{ title: string; status: string }>;
    }>('get_email_detail', { id: emailId });
    expect(detail.email.summary).toBe('Closes Friday.');
    expect(detail.events[0]).toMatchObject({
      title: 'Registration closes',
      status: 'pending_review',
    });
  });

  it('reclassifies junk to actionable and reruns extraction', async () => {
    const emailId = await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 7,
      uidvalidity: 1,
      message_id: '<reg-2026-041@stateu.edu>',
      from_addr: 'registrar@stateu.edu',
      subject: 'Registration for Fall 2026 closes Friday',
      received_at: '2026-07-14T13:30:00.000Z',
      classification: 'junk',
      summary: null,
      extracted_count: 0,
      notified: false,
      processed_at: null,
    });
    engineMock.enqueueNotification.mockClear();
    const result = await invoke<{
      email: { classification: string; summary: string };
      events: Array<{ email_id: string }>;
    }>('reclassify_email', { id: emailId, classification: 'actionable' });
    expect(result.email.classification).toBe('actionable');
    expect(result.email.summary).toContain('registration');
    expect(result.events.filter((event) => event.email_id === emailId)).toHaveLength(1);
    expect(engineMock.enqueueNotification).toHaveBeenCalled();
  });

  it('dismisses linked tasks and replaces events without duplicates', async () => {
    const emailId = await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 7,
      uidvalidity: 1,
      message_id: '<reg-2026-041@stateu.edu>',
      from_addr: 'registrar@stateu.edu',
      subject: 'Registration for Fall 2026 closes Friday',
      received_at: '2026-07-14T13:30:00.000Z',
      classification: 'actionable',
      summary: 'Old summary',
      extracted_count: 1,
      notified: true,
      processed_at: null,
    });
    await store.insertExtractedEvent({
      email_id: emailId,
      title: 'Old deadline',
      event_type: 'registration',
      due_at: '2026-07-20T21:00:00.000Z',
      confidence: 0.95,
      status: 'accepted',
      task_id: 'old-task',
    });
    callMock.callTool.mockClear();

    await invoke('reclassify_email', {
      id: emailId,
      classification: 'actionable',
    });
    expect(callMock.callTool).toHaveBeenCalledWith(
      'dismiss_task',
      { id: 'old-task' },
      context,
    );
    expect(await store.listExtractedEventsForEmail(emailId)).toHaveLength(1);

    await invoke('reclassify_email', {
      id: emailId,
      classification: 'actionable',
    });
    expect(await store.listExtractedEventsForEmail(emailId)).toHaveLength(1);
  });

  it('reclassifies to junk and clears summary and events', async () => {
    const emailId = await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 8,
      uidvalidity: 1,
      message_id: '<f@x>',
      from_addr: 'a@b.edu',
      subject: 'Old',
      received_at: '2026-07-15T00:00:00.000Z',
      classification: 'actionable',
      summary: 'was actionable',
      extracted_count: 1,
      notified: true,
      processed_at: null,
    });
    await store.insertExtractedEvent({
      email_id: emailId,
      title: 't',
      event_type: 'general',
      due_at: null,
      confidence: 0.5,
      status: 'pending_review',
      task_id: null,
    });
    const result = await invoke<{
      email: { classification: string; summary: string | null };
      events: unknown[];
    }>('reclassify_email', { id: emailId, classification: 'junk' });
    expect(result.email).toMatchObject({ classification: 'junk', summary: null });
    expect(result.events).toHaveLength(0);
  });
});

describe('event review tools', () => {
  it('filters events and joins source email fields', async () => {
    const pending = await invoke<{
      events: Array<{ email_subject: string; email_from: string }>;
    }>('list_extracted_events', { status: 'pending_review' });
    expect(pending.events.length).toBeGreaterThan(0);
    expect(pending.events[0]).toHaveProperty('email_subject');
    expect(pending.events[0]).toHaveProperty('email_from');
  });

  it('accepts an event, creates a task, and links it', async () => {
    const emailId = await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 9,
      uidvalidity: 1,
      message_id: '<g@x>',
      from_addr: 'bursar@stateu.edu',
      subject: 'Tuition due',
      received_at: '2026-07-16T00:00:00.000Z',
      classification: 'actionable',
      summary: 'Tuition due Aug 1.',
      extracted_count: 1,
      notified: true,
      processed_at: null,
    });
    const eventId = await store.insertExtractedEvent({
      email_id: emailId,
      title: 'Pay tuition',
      event_type: 'payment',
      due_at: '2026-08-01T04:00:00.000Z',
      confidence: 0.7,
      status: 'pending_review',
      task_id: null,
    });
    callMock.callTool.mockClear();
    const result = await invoke<{
      event: { status: string; task_id: string };
    }>('accept_event', { id: eventId });
    expect(result.event).toMatchObject({ status: 'accepted', task_id: 'task-9' });
    expect(callMock.callTool).toHaveBeenCalledWith(
      'create_task',
      expect.objectContaining({
        title: 'Pay tuition',
        category: 'payment',
        source: 'email',
        source_email_id: emailId,
      }),
      context,
    );
  });

  it('accepts without a task and dismisses a linked task', async () => {
    const emailId = await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 10,
      uidvalidity: 1,
      message_id: '<h@x>',
      from_addr: 'x@y.edu',
      subject: 'S',
      received_at: '2026-07-16T01:00:00.000Z',
      classification: 'actionable',
      summary: 's',
      extracted_count: 1,
      notified: true,
      processed_at: null,
    });
    const eventId = await store.insertExtractedEvent({
      email_id: emailId,
      title: 't2',
      event_type: 'general',
      due_at: null,
      confidence: 0.5,
      status: 'pending_review',
      task_id: null,
    });
    const accepted = await invoke<{ event: { task_id: string | null } }>(
      'accept_event',
      { id: eventId, create_task: false },
    );
    expect(accepted.event.task_id).toBeNull();
    await store.updateExtractedEvent(eventId, { task_id: 'task-9' });
    callMock.callTool.mockClear();
    const dismissed = await invoke<{ event: { status: string } }>(
      'dismiss_event',
      { id: eventId },
    );
    expect(dismissed.event.status).toBe('dismissed');
    expect(callMock.callTool).toHaveBeenCalledWith(
      'dismiss_task',
      { id: 'task-9' },
      context,
    );
  });
});

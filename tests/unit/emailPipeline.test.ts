import { beforeAll, describe, expect, it, vi } from 'vitest';
import { freshEmailTestDb } from '../helpers/emailTestDb';
import { FakeImapConnection, loadEml } from '../fixtures/imap/fakeImapConnection';
import type { TriageOutcome } from '../../src/server/ai/triage';

vi.mock('../../src/server/notify/engine', () => ({
  enqueueNotification: vi.fn(async () => 'notif-1'),
}));
vi.mock('../../src/server/tools/call', () => ({
  callTool: vi.fn(async () => ({ id: 'task-1' })),
}));

let pipeline: typeof import('../../src/server/email/pipeline');
let store: typeof import('../../src/server/email/store');
let settings: typeof import('../../src/server/settings');
let imapClient: typeof import('../../src/server/email/imapClient');
let engineMock: { enqueueNotification: ReturnType<typeof vi.fn> };
let callMock: { callTool: ReturnType<typeof vi.fn> };

const actionable = (over: Record<string, unknown> = {}): TriageOutcome[] => [{
  ok: true,
  result: {
    classification: 'actionable',
    summary: 'Registration closes Friday 5pm.',
    importance: 'urgent',
    events: [{
      title: 'Registration closes',
      event_type: 'registration',
      due_at: '2026-07-24T21:00:00.000Z',
      confidence: 0.97,
    }],
    rationale: 'deadline',
    ...over,
  } as never,
}];

function fakeSource(messages: Array<{ uid: number; eml: string }>, uidvalidity = 7) {
  return {
    fetchNew: (mailbox: string, lastUid: number, lastUidvalidity: number | null) =>
      imapClient.fetchNewMessages(
        new FakeImapConnection({ uidvalidity, messages }),
        mailbox,
        lastUid,
        lastUidvalidity,
      ),
    fetchByUid: async () => null,
  };
}

beforeAll(async () => {
  await freshEmailTestDb();
  pipeline = await import('../../src/server/email/pipeline');
  store = await import('../../src/server/email/store');
  settings = await import('../../src/server/settings');
  imapClient = await import('../../src/server/email/imapClient');
  engineMock = await import('../../src/server/notify/engine') as unknown as typeof engineMock;
  callMock = await import('../../src/server/tools/call') as unknown as typeof callMock;
  await settings.updateSettings({
    imap: {
      host: 'imap.stateu.edu',
      port: 993,
      tls: true,
      username: 'alex@stateu.edu',
      mailbox: 'INBOX',
      poll_interval_minutes: 5,
      enabled: true,
      auto_accept_events: true,
      last_uid: 100,
      uidvalidity: 7,
      last_poll_at: null,
      last_error: null,
      backoff_step: 0,
      next_poll_after: null,
    },
  });
});

describe('runEmailPipeline', () => {
  it('persists actionable email, accepted event, task, notification, and cursor', async () => {
    const result = await pipeline.runEmailPipeline({
      source: fakeSource([{ uid: 101, eml: loadEml('actionable.eml') }]),
      triage: async () => actionable(),
      now: () => new Date('2026-07-17T12:00:00Z'),
    });
    expect(result).toMatchObject({ fetched: 1, actionable: 1, junk: 0, unprocessed: 0 });
    const emails = (await store.listProcessedEmails({ limit: 10, offset: 0 })).emails;
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      uid: 101,
      uidvalidity: 7,
      classification: 'actionable',
      notified: true,
      message_id: '<reg-2026-041@stateu.edu>',
    });
    expect((await store.listExtractedEvents({ limit: 10, offset: 0 }))[0])
      .toMatchObject({ status: 'accepted', task_id: 'task-1' });
    expect(callMock.callTool).toHaveBeenCalledWith(
      'create_task',
      expect.objectContaining({
        source: 'email',
        source_email_id: emails[0].id,
        category: 'registration',
      }),
      expect.anything(),
    );
    expect(engineMock.enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email_summary',
      importance: 'urgent',
      body: expect.stringContaining('Registration closes'),
      relatedType: 'email',
      relatedId: emails[0].id,
    }));
    expect((await settings.getSettings()).imap.last_uid).toBe(101);
    expect((await settings.getSettings()).imap.last_error).toBeNull();
  });

  it('dedupes a refetched UID', async () => {
    engineMock.enqueueNotification.mockClear();
    const connection = new FakeImapConnection({
      uidvalidity: 7,
      messages: [{ uid: 101, eml: loadEml('actionable.eml') }],
    });
    const refetched = await imapClient.fetchNewMessages(connection, 'INBOX', 0, null);
    const result = await pipeline.runEmailPipeline({
      source: { fetchNew: async () => refetched, fetchByUid: async () => null },
      triage: async () => actionable(),
      now: () => new Date('2026-07-17T12:05:00Z'),
    });
    expect(result).toMatchObject({ fetched: 1, skipped: 1, actionable: 0 });
    expect((await store.listProcessedEmails({ limit: 10, offset: 0 })).emails).toHaveLength(1);
    expect(engineMock.enqueueNotification).not.toHaveBeenCalled();
  });

  it('short-circuits AI for junk sender rules', async () => {
    await store.insertSenderRule({ pattern: 'campusstore.example', action: 'junk' });
    const triage = vi.fn(async () => actionable());
    engineMock.enqueueNotification.mockClear();
    const result = await pipeline.runEmailPipeline({
      source: fakeSource([{ uid: 102, eml: loadEml('junk.eml') }]),
      triage,
      now: () => new Date('2026-07-17T12:10:00Z'),
    });
    expect(result.junk).toBe(1);
    expect(triage).not.toHaveBeenCalled();
    expect(engineMock.enqueueNotification).not.toHaveBeenCalled();
    expect((await store.listProcessedEmails({
      classification: 'junk',
      limit: 10,
      offset: 0,
    })).emails[0].from_addr).toBe('deals@campusstore.example');
  });

  it('forces important sender rules to actionable and urgent', async () => {
    await store.insertSenderRule({ pattern: 'library@stateu.edu', action: 'important' });
    const triage = vi.fn(async () => actionable());
    engineMock.enqueueNotification.mockClear();
    const result = await pipeline.runEmailPipeline({
      source: fakeSource([{ uid: 103, eml: loadEml('informational.eml') }]),
      triage,
      now: () => new Date('2026-07-17T12:15:00Z'),
    });
    expect(result.actionable).toBe(1);
    expect(triage).not.toHaveBeenCalled();
    expect(engineMock.enqueueNotification)
      .toHaveBeenCalledWith(expect.objectContaining({ importance: 'urgent' }));
  });

  it('leaves AI failures unprocessed without advancing the cursor, then retries', async () => {
    const eml = loadEml('newsletter.eml')
      .replace('<news-2026-29@stateu.edu>', '<news-104@stateu.edu>');
    const failed = await pipeline.runEmailPipeline({
      source: fakeSource([{ uid: 104, eml }]),
      triage: async () => {
        throw new Error('AI provider 503');
      },
      now: () => new Date('2026-07-17T12:20:00Z'),
    });
    expect(failed.unprocessed).toBe(1);
    expect((await settings.getSettings()).imap.last_uid).toBe(103);
    expect((await store.listProcessedEmails({ limit: 50, offset: 0 })).emails
      .find((email) => email.uid === 104)?.classification).toBe('unprocessed');

    const retried = await pipeline.runEmailPipeline({
      source: fakeSource([{ uid: 104, eml }]),
      triage: async () => actionable(),
      now: () => new Date('2026-07-17T12:25:00Z'),
    });
    expect(retried.actionable).toBe(1);
    const emails = (await store.listProcessedEmails({ limit: 50, offset: 0 })).emails
      .filter((email) => email.uid === 104);
    expect(emails).toHaveLength(1);
    expect(emails[0].classification).toBe('actionable');
    expect((await settings.getSettings()).imap.last_uid).toBe(104);
  });

  it('leaves a new email unprocessed when child creation fails', async () => {
    const eml = loadEml('actionable.eml')
      .replace('<reg-2026-041@stateu.edu>', '<reg-child-failure@stateu.edu>');
    callMock.callTool.mockRejectedValueOnce(new Error('task write failed'));

    await expect(pipeline.runEmailPipeline({
      source: fakeSource([{ uid: 107, eml }]),
      triage: async () => actionable(),
      now: () => new Date('2026-07-17T12:27:00Z'),
    })).rejects.toThrow('task write failed');

    const email = (await store.listProcessedEmails({ limit: 50, offset: 0 })).emails
      .find((candidate) => candidate.uid === 107);
    expect(email).toMatchObject({
      classification: 'unprocessed',
      extracted_count: 0,
      processed_at: null,
    });
    expect(await store.listExtractedEventsForEmail(email!.id)).toEqual([]);
  });

  it('stops after an invalid per-message result', async () => {
    const first = loadEml('junk.eml')
      .replace('<promo-8888@campusstore.example>', '<promo-105@campusstore.example>');
    const second = loadEml('newsletter.eml')
      .replace('<news-2026-29@stateu.edu>', '<news-106@stateu.edu>');
    const result = await pipeline.runEmailPipeline({
      source: fakeSource([{ uid: 105, eml: first }, { uid: 106, eml: second }]),
      triage: async () => [{ ok: false, error: 'bad json' }],
      now: () => new Date('2026-07-17T12:30:00Z'),
    });
    expect(result.junk).toBe(1);
    expect(result.unprocessed).toBe(1);
    expect((await settings.getSettings()).imap.last_uid).toBe(105);
  });

  it('rolls back an actionable email when summary enqueue fails, then retries it', async () => {
    const eml = loadEml('actionable.eml')
      .replace('<reg-2026-041@stateu.edu>', '<reg-notify-failure@stateu.edu>');
    engineMock.enqueueNotification.mockRejectedValueOnce(new Error('notification write failed'));

    await expect(pipeline.runEmailPipeline({
      source: fakeSource([{ uid: 108, eml }]),
      triage: async () => actionable(),
      now: () => new Date('2026-07-17T12:31:00Z'),
    })).rejects.toThrow('notification write failed');

    let email = (await store.listProcessedEmails({ limit: 50, offset: 0 })).emails
      .find((candidate) => candidate.uid === 108);
    expect(email).toMatchObject({
      classification: 'unprocessed',
      extracted_count: 0,
      processed_at: null,
    });
    expect(await store.listExtractedEventsForEmail(email!.id)).toEqual([]);

    expect((await pipeline.runEmailPipeline({
      source: fakeSource([{ uid: 108, eml }]),
      triage: async () => actionable(),
      now: () => new Date('2026-07-17T12:32:00Z'),
    })).actionable).toBe(1);
    email = await store.getProcessedEmail(email!.id) ?? undefined;
    expect(email).toMatchObject({ classification: 'actionable', notified: true });
  });

  it('dedupes a UIDVALIDITY rescan by Message-ID', async () => {
    for (const rule of await store.listSenderRules()) {
      await store.deleteSenderRule(rule.id);
    }
    const result = await pipeline.runEmailPipeline({
      source: fakeSource([
        { uid: 1, eml: loadEml('actionable.eml') },
        { uid: 2, eml: loadEml('newsletter.eml') },
      ], 99),
      triage: async () => [{
        ok: true,
        result: {
          classification: 'informational',
          summary: 'Campus weekly roundup.',
          importance: 'low',
          events: [],
          rationale: 'fyi',
        },
      }],
      now: () => new Date('2026-07-17T12:35:00Z'),
    });
    expect(result.skipped).toBe(1);
    expect(result.informational).toBe(1);
    expect((await settings.getSettings()).imap).toMatchObject({
      uidvalidity: 99,
      last_uid: 2,
    });
    expect((await store.listProcessedEmails({ limit: 50, offset: 0 })).emails
      .filter((email) => email.message_id === '<reg-2026-041@stateu.edu>')).toHaveLength(1);
  });

  it('records informational email for digest without notification', async () => {
    engineMock.enqueueNotification.mockClear();
    await settings.updateSettings({ imap: { last_uid: 2, uidvalidity: 99 } });
    const eml = loadEml('newsletter.eml')
      .replace('<news-2026-29@stateu.edu>', '<news-uid3@stateu.edu>');
    const result = await pipeline.runEmailPipeline({
      source: fakeSource([{ uid: 3, eml }], 99),
      triage: async () => [{
        ok: true,
        result: {
          classification: 'informational',
          summary: 'Campus weekly roundup.',
          importance: 'low',
          events: [],
          rationale: 'fyi',
        },
      }],
      now: () => new Date('2026-07-17T12:40:00Z'),
    });
    expect(result.informational).toBe(1);
    expect(engineMock.enqueueNotification).not.toHaveBeenCalled();
    expect((await store.listProcessedEmails({
      classification: 'informational',
      limit: 10,
      offset: 0,
    })).emails[0].notified).toBe(false);
  });

  it('does nothing when IMAP is unconfigured', async () => {
    await settings.updateSettings({ imap: { enabled: false } });
    const result = await pipeline.runEmailPipeline({
      source: fakeSource([]),
      triage: async () => actionable(),
    });
    expect(result.configured).toBe(false);
    expect(result.fetched).toBe(0);
  });
});

describe('matchSenderRule', () => {
  it('matches exact address, domain, and subdomain case-insensitively', () => {
    expect(pipeline.matchSenderRule(
      'Deals@CampusStore.example',
      'deals@campusstore.example',
    )).toBe(true);
    expect(pipeline.matchSenderRule(
      'library@stateu.edu',
      'news@stateu.edu',
    )).toBe(false);
    expect(pipeline.matchSenderRule(
      'campusstore.example',
      'deals@campusstore.example',
    )).toBe(true);
    expect(pipeline.matchSenderRule(
      'campusstore.example',
      'a@mail.campusstore.example',
    )).toBe(true);
    expect(pipeline.matchSenderRule(
      'ampusstore.example',
      'deals@campusstore.example',
    )).toBe(false);
    expect(pipeline.matchSenderRule(
      'stateu.edu',
      'deals@campusstore.example',
    )).toBe(false);
  });
});

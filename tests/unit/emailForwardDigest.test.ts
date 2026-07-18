import { beforeAll, describe, expect, it, vi } from 'vitest';
import { freshEmailTestDb } from '../helpers/emailTestDb';

vi.mock('../../src/server/notify/engine', () => ({
  enqueueNotification: vi.fn(async () => 'notif-9'),
}));

let forward: typeof import('../../src/server/email/forward');
let digest: typeof import('../../src/server/email/digest');
let store: typeof import('../../src/server/email/store');
let settings: typeof import('../../src/server/settings');
let engineMock: { enqueueNotification: ReturnType<typeof vi.fn> };

beforeAll(async () => {
  await freshEmailTestDb();
  forward = await import('../../src/server/email/forward');
  digest = await import('../../src/server/email/digest');
  store = await import('../../src/server/email/store');
  settings = await import('../../src/server/settings');
  engineMock = await import('../../src/server/notify/engine') as unknown as typeof engineMock;
  await settings.updateSettings({ timezone: 'America/New_York' });
});

describe('forwardActionableSummary', () => {
  it('enqueues a personal summary with extracted dates and dashboard link', async () => {
    await forward.forwardActionableSummary(
      {
        id: 'em1',
        subject: 'Registration closes Friday',
        from_addr: 'registrar@stateu.edu',
        summary: 'Your Fall 2026 registration closes Friday at 5pm.',
      },
      [{
        id: 'ev1',
        email_id: 'em1',
        title: 'Registration closes',
        event_type: 'registration',
        due_at: '2026-07-24T21:00:00.000Z',
        confidence: 0.97,
        status: 'accepted',
        task_id: 't1',
        created_at: '',
      }],
      'urgent',
      new Date('2026-07-17T12:00:00Z'),
    );

    expect(engineMock.enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email_summary',
      importance: 'urgent',
      channels: ['in_app', 'email'],
      relatedType: 'email',
      relatedId: 'em1',
      scheduledFor: new Date('2026-07-17T12:00:00Z'),
    }));
    const input = engineMock.enqueueNotification.mock.calls[0][0] as {
      title: string;
      body: string;
    };
    expect(input.title).toMatch(/^☁️ Redi: /);
    expect(input.title).toContain('registration closes Friday');
    expect(input.body).toContain('Fall 2026 registration closes Friday at 5pm');
    expect(input.body).toContain('Registration closes');
    expect(input.body).toContain('Jul 24, 2026');
    expect(input.body).toContain('/email');
    expect(input.body).not.toContain('Dear Alex');
  });

  it('uses the subject when there is no summary', async () => {
    engineMock.enqueueNotification.mockClear();
    await forward.forwardActionableSummary(
      {
        id: 'em2',
        subject: 'Important sender - Tuition',
        from_addr: 'bursar@stateu.edu',
        summary: null,
      },
      [],
      'urgent',
      new Date(),
    );
    expect(engineMock.enqueueNotification.mock.calls[0][0].title)
      .toBe('☁️ Redi: Important sender - Tuition');
  });
});

describe('college email digest', () => {
  it('collects unsurfaced informational email oldest first and marks included rows', async () => {
    await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 1,
      uidvalidity: 1,
      message_id: '<a@x>',
      from_addr: 'library@stateu.edu',
      subject: 'Summer hours',
      received_at: '2026-07-16T08:00:00.000Z',
      classification: 'informational',
      summary: 'Library open 8-6.',
      extracted_count: 0,
      notified: false,
      processed_at: null,
    });
    await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 2,
      uidvalidity: 1,
      message_id: '<b@x>',
      from_addr: 'deals@x.example',
      subject: 'Promo',
      received_at: '2026-07-16T09:00:00.000Z',
      classification: 'junk',
      summary: null,
      extracted_count: 0,
      notified: false,
      processed_at: null,
    });
    await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 3,
      uidvalidity: 1,
      message_id: '<c@x>',
      from_addr: 'it@stateu.edu',
      subject: 'VPN maintenance',
      received_at: '2026-07-16T10:00:00.000Z',
      classification: 'informational',
      summary: 'VPN down Sunday 2am.',
      extracted_count: 0,
      notified: true,
      processed_at: null,
    });

    const items = await digest.collectCollegeEmailDigestItems();
    expect(items.map((item) => item.subject)).toEqual(['Summer hours']);
    expect(digest.renderCollegeEmailDigestSection(items))
      .toContain('Summer hours - Library open 8-6.');
    await store.insertProcessedEmail({
      mailbox: 'INBOX',
      uid: 4,
      uidvalidity: 1,
      message_id: '<d@x>',
      from_addr: 'new@stateu.edu',
      subject: 'Arrived during digest',
      received_at: '2026-07-16T11:00:00.000Z',
      classification: 'informational',
      summary: 'Keep this for tomorrow.',
      extracted_count: 0,
      notified: false,
      processed_at: null,
    });
    await digest.markCollegeEmailDigestItemsIncluded(
      items.map(({ id }) => id),
    );
    expect((await digest.collectCollegeEmailDigestItems())
      .map(({ subject }) => subject)).toEqual(['Arrived during digest']);
    expect(digest.renderCollegeEmailDigestSection([])).toBe('');
  });
});

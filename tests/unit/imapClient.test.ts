import { describe, expect, it } from 'vitest';
import {
  fetchMessageByUid,
  fetchNewMessages,
  htmlToText,
} from '../../src/server/email/imapClient';
import { FakeImapConnection, loadEml } from '../fixtures/imap/fakeImapConnection';

describe('imapClient.fetchNewMessages', () => {
  it('initial sync fetches at most the latest 200 messages, sorted by uid', async () => {
    const messages = Array.from(
      { length: 250 },
      (_, index) => ({ uid: index + 1, eml: loadEml('junk.eml') }),
    );
    const connection = new FakeImapConnection({ uidvalidity: 7, messages });
    const result = await fetchNewMessages(connection, 'INBOX', 0, null);
    expect(result.uidvalidity).toBe(7);
    expect(result.rescan).toBe(true);
    expect(result.messages).toHaveLength(200);
    expect(result.messages[0].uid).toBe(51);
    expect(result.messages[199].uid).toBe(250);
    expect(connection.calls).toContain('release');
  });

  it('cursor fetch returns only messages with uid > lastUid', async () => {
    const connection = new FakeImapConnection({
      uidvalidity: 7,
      messages: [
        { uid: 100, eml: loadEml('junk.eml') },
        { uid: 101, eml: loadEml('actionable.eml') },
        { uid: 102, eml: loadEml('informational.eml') },
      ],
    });
    const result = await fetchNewMessages(connection, 'INBOX', 100, 7);
    expect(result.rescan).toBe(false);
    expect(result.messages.map((message) => message.uid)).toEqual([101, 102]);
    expect(connection.calls).toContain('fetch:101:*:uid');
  });

  it('UIDVALIDITY change triggers a rescan of the latest window', async () => {
    const connection = new FakeImapConnection({
      uidvalidity: 99,
      messages: [{ uid: 5, eml: loadEml('actionable.eml') }],
    });
    const result = await fetchNewMessages(connection, 'INBOX', 5, 7);
    expect(result.rescan).toBe(true);
    expect(result.uidvalidity).toBe(99);
    expect(result.messages).toHaveLength(1);
    expect(connection.calls).toContain('fetch:1:*:seq');
  });

  it('parses envelope fields and plain-text body', async () => {
    const connection = new FakeImapConnection({
      uidvalidity: 1,
      messages: [{ uid: 1, eml: loadEml('actionable.eml') }],
    });
    const [message] = (await fetchNewMessages(connection, 'INBOX', 0, null)).messages;
    expect(message.from).toBe('registrar@stateu.edu');
    expect(message.subject).toContain('Registration');
    expect(message.messageId).toBe('<reg-2026-041@stateu.edu>');
    expect(message.receivedAt.getUTCFullYear()).toBe(2026);
    expect(message.text).toContain('July 24, 2026');
  });

  it('uses only lock, fetch, release, and logout operations', async () => {
    const connection = new FakeImapConnection({
      uidvalidity: 1,
      messages: [{ uid: 1, eml: loadEml('junk.eml') }],
    });
    await fetchNewMessages(connection, 'INBOX', 0, null);
    for (const call of connection.calls) {
      expect(call).toMatch(/^(getMailboxLock|fetch|fetchOne|release|logout)/);
    }
  });

  it('fetchMessageByUid returns null when the uid does not exist', async () => {
    const connection = new FakeImapConnection({ uidvalidity: 1, messages: [] });
    expect(await fetchMessageByUid(connection, 'INBOX', 42)).toBeNull();
  });
});

describe('htmlToText', () => {
  it('strips tags, keeps link targets, and collapses whitespace', () => {
    const output = htmlToText(
      '<p>Hi <b>Alex</b>, see <a href="https://x.edu/portal">the portal</a>.</p>' +
      '<script>bad()</script>',
    );
    expect(output).toBe('Hi Alex, see the portal (https://x.edu/portal).');
  });
});

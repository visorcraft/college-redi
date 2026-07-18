import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getSecret } from '../secrets';
import { getSettings } from '../settings';

export interface RawImapMessage {
  uid: number;
  source: Buffer;
  internalDate?: Date;
}

export interface MailboxInfo {
  uidvalidity: number | bigint;
  exists: number | bigint;
}

export interface ImapConnection {
  connect(): Promise<void>;
  getMailboxLock(
    path: string,
    options?: { readOnly?: boolean },
  ): Promise<{ mailbox: MailboxInfo; release(): void }>;
  fetch(
    range: string,
    query: Record<string, unknown>,
    options?: { uid?: boolean },
  ): AsyncIterable<RawImapMessage>;
  fetchOne(
    uid: number,
    query: Record<string, unknown>,
    options?: { uid?: boolean },
  ): Promise<RawImapMessage | false>;
  logout(): Promise<void>;
}

export interface FetchedEmail {
  uid: number;
  messageId: string;
  from: string;
  subject: string;
  receivedAt: Date;
  text: string;
}

export interface FetchNewResult {
  uidvalidity: number;
  rescan: boolean;
  messages: FetchedEmail[];
}

export class ImapNotConfiguredError extends Error {
  constructor() {
    super('IMAP is not configured');
    this.name = 'ImapNotConfiguredError';
  }
}

export class ImapUidvalidityChangedError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`mailbox UIDVALIDITY changed from ${expected} to ${actual}`);
    this.name = 'ImapUidvalidityChangedError';
  }
}

export interface ImapConfig {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  mailbox: string;
}

export async function resolveImapConfig(): Promise<ImapConfig> {
  const { imap } = await getSettings();
  const password = await getSecret('imap.password');
  if (!imap.enabled || !imap.host || !imap.username || !password) {
    throw new ImapNotConfiguredError();
  }
  return {
    host: imap.host,
    port: imap.port,
    tls: imap.tls,
    username: imap.username,
    password,
    mailbox: imap.mailbox,
  };
}

export function isImapAuthError(error: unknown): boolean {
  const candidate = error as {
    authenticationFailed?: boolean;
    serverResponseCode?: unknown;
    responseText?: unknown;
    message?: unknown;
  };
  const detail = candidate.serverResponseCode ?? candidate.responseText ?? candidate.message ?? '';
  return candidate.authenticationFailed === true
    || /AUTHENTICATIONFAILED|AUTHORIZATIONFAILED|invalid credentials/i.test(String(detail));
}

const FETCH_QUERY = {
  uid: true,
  envelope: true,
  internalDate: true,
  source: true,
};
const IMAP_CONNECTION_TIMEOUT_MS = 30_000;
const IMAP_SOCKET_TIMEOUT_MS = 120_000;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(
      /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, label: string) => `${label.replace(/<[^>]+>/g, '')} (${href})`,
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

async function toFetchedEmail(raw: RawImapMessage): Promise<FetchedEmail> {
  const parsed = await simpleParser(raw.source);
  return {
    uid: raw.uid,
    messageId: parsed.messageId ?? '',
    from: parsed.from?.value[0]?.address ?? '',
    subject: parsed.subject ?? '(no subject)',
    receivedAt: parsed.date ?? raw.internalDate ?? new Date(),
    text: (parsed.text ?? '').trim()
      || htmlToText(typeof parsed.html === 'string' ? parsed.html : ''),
  };
}

export async function fetchNewMessages(
  connection: ImapConnection,
  mailbox: string,
  lastUid: number,
  lastUidvalidity: number | null,
): Promise<FetchNewResult> {
  const lock = await connection.getMailboxLock(mailbox, { readOnly: true });
  try {
    const uidvalidity = Number(lock.mailbox.uidvalidity);
    const exists = Number(lock.mailbox.exists);
    const messages: FetchedEmail[] = [];
    const rescan = lastUid === 0
      || (lastUidvalidity !== null && lastUidvalidity !== uidvalidity);

    if (rescan) {
      if (exists > 0) {
        const start = Math.max(1, exists - 199);
        for await (const raw of connection.fetch(`${start}:*`, FETCH_QUERY)) {
          messages.push(await toFetchedEmail(raw));
        }
      }
    } else {
      for await (const raw of connection.fetch(
        `${lastUid + 1}:*`,
        FETCH_QUERY,
        { uid: true },
      )) {
        messages.push(await toFetchedEmail(raw));
      }
    }
    messages.sort((left, right) => left.uid - right.uid);
    return { uidvalidity, rescan, messages };
  } finally {
    lock.release();
  }
}

export async function fetchMessageByUid(
  connection: ImapConnection,
  mailbox: string,
  uid: number,
  expectedUidvalidity?: number,
): Promise<FetchedEmail | null> {
  const lock = await connection.getMailboxLock(mailbox, { readOnly: true });
  try {
    const uidvalidity = Number(lock.mailbox.uidvalidity);
    if (expectedUidvalidity !== undefined && uidvalidity !== expectedUidvalidity) {
      throw new ImapUidvalidityChangedError(expectedUidvalidity, uidvalidity);
    }
    const raw = await connection.fetchOne(uid, FETCH_QUERY, { uid: true });
    return raw ? toFetchedEmail(raw) : null;
  } finally {
    lock.release();
  }
}

class ImapFlowConnection implements ImapConnection {
  private readonly client: ImapFlow;

  constructor(config: ImapConfig) {
    this.client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.tls,
      auth: { user: config.username, pass: config.password },
      logger: false,
      connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async getMailboxLock(path: string, options?: { readOnly?: boolean }) {
    const lock = await this.client.getMailboxLock(path, options);
    const mailbox = this.client.mailbox;
    return {
      mailbox: {
        uidvalidity: Number(mailbox && mailbox.uidValidity || 0),
        exists: Number(mailbox && mailbox.exists || 0),
      },
      release: () => lock.release(),
    };
  }

  fetch(range: string, query: Record<string, unknown>, options?: { uid?: boolean }) {
    return this.client.fetch(range, query, options) as AsyncIterable<RawImapMessage>;
  }

  async fetchOne(uid: number, query: Record<string, unknown>, options?: { uid?: boolean }) {
    return await this.client.fetchOne(uid, query, options) as RawImapMessage | false;
  }

  async logout(): Promise<void> {
    await this.client.logout();
  }
}

export interface ImapSource {
  fetchNew(
    mailbox: string,
    lastUid: number,
    lastUidvalidity: number | null,
  ): Promise<FetchNewResult>;
  fetchByUid(
    mailbox: string,
    uid: number,
    expectedUidvalidity?: number,
  ): Promise<FetchedEmail | null>;
}

export function createImapSource(): ImapSource {
  async function withConnection<T>(
    run: (connection: ImapConnection) => Promise<T>,
  ): Promise<T> {
    const config = await resolveImapConfig();
    const connection = new ImapFlowConnection(config);
    await connection.connect();
    try {
      return await run(connection);
    } finally {
      await connection.logout().catch(() => undefined);
    }
  }

  return {
    fetchNew: (mailbox, lastUid, lastUidvalidity) =>
      withConnection((connection) =>
        fetchNewMessages(connection, mailbox, lastUid, lastUidvalidity),
      ),
    fetchByUid: (mailbox, uid, expectedUidvalidity) =>
      withConnection((connection) =>
        fetchMessageByUid(connection, mailbox, uid, expectedUidvalidity),
      ),
  };
}

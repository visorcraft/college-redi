import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImapConnection, RawImapMessage } from '../../../src/server/email/imapClient';

export interface FakeImapMessage {
  uid: number;
  eml: string;
  internalDate?: Date;
}

export class FakeImapConnection implements ImapConnection {
  calls: string[] = [];

  constructor(
    public opts: { uidvalidity: number; messages: FakeImapMessage[]; failConnect?: Error },
  ) {}

  async connect(): Promise<void> {
    this.calls.push('connect');
    if (this.opts.failConnect) throw this.opts.failConnect;
  }

  async getMailboxLock(path: string) {
    this.calls.push(`getMailboxLock:${path}`);
    return {
      mailbox: {
        uidvalidity: this.opts.uidvalidity,
        exists: this.opts.messages.length,
      },
      release: () => {
        this.calls.push('release');
      },
    };
  }

  async *fetch(
    range: string,
    _query: unknown,
    options?: { uid?: boolean },
  ): AsyncIterable<RawImapMessage> {
    this.calls.push(`fetch:${range}:${options?.uid ? 'uid' : 'seq'}`);
    const sorted = [...this.opts.messages].sort((a, b) => a.uid - b.uid);
    const start = Number(/^(\d+):\*$/.exec(range)?.[1] ?? '1');
    const picked = options?.uid
      ? sorted.filter((message) => message.uid >= start)
      : sorted.slice(start - 1);
    for (const message of picked) {
      yield {
        uid: message.uid,
        source: Buffer.from(message.eml),
        internalDate: message.internalDate,
      };
    }
  }

  async fetchOne(
    uid: number,
    _query: unknown,
    options?: { uid?: boolean },
  ): Promise<RawImapMessage | false> {
    this.calls.push(`fetchOne:${uid}:${options?.uid ? 'uid' : 'seq'}`);
    const hit = this.opts.messages.find((message, index) =>
      options?.uid ? message.uid === uid : index === uid - 1,
    );
    return hit
      ? { uid: hit.uid, source: Buffer.from(hit.eml), internalDate: hit.internalDate }
      : false;
  }

  async logout(): Promise<void> {
    this.calls.push('logout');
  }
}

export function loadEml(name: string): string {
  return readFileSync(join(__dirname, '..', 'emails', name), 'utf8');
}

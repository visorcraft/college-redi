import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv, teardownTestEnv } from '../helpers/testEnv';

interface Mail {
  uid: number;
  source: string;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function quoted(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function startImapServer(messages: Mail[]) {
  let uidValidity = 41;
  const server = createServer((socket) => {
    let buffer = '';
    let authTag = '';
    socket.write('* OK Redi integration IMAP ready\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (authTag) {
          socket.write(`${authTag} OK AUTHENTICATE completed\r\n`);
          authTag = '';
          continue;
        }
        const [tag = '', command = '', ...rest] = line.split(' ');
        const args = rest.join(' ');
        switch (command.toUpperCase()) {
          case 'CAPABILITY':
            socket.write('* CAPABILITY IMAP4rev1 NAMESPACE AUTH=PLAIN SASL-IR\r\n');
            socket.write(`${tag} OK CAPABILITY completed\r\n`);
            break;
          case 'AUTHENTICATE':
            if (rest.length > 1) {
              socket.write(`${tag} OK AUTHENTICATE completed\r\n`);
            } else {
              authTag = tag;
              socket.write('+ \r\n');
            }
            break;
          case 'LOGIN':
          case 'ENABLE':
          case 'ID':
            socket.write(`${tag} OK ${command} completed\r\n`);
            break;
          case 'NAMESPACE':
            socket.write('* NAMESPACE (("" "/")) NIL NIL\r\n');
            socket.write(`${tag} OK NAMESPACE completed\r\n`);
            break;
          case 'LIST':
            socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');
            socket.write(`${tag} OK LIST completed\r\n`);
            break;
          case 'SELECT':
          case 'EXAMINE':
            socket.write('* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)\r\n');
            socket.write(`* ${messages.length} EXISTS\r\n`);
            socket.write(`* OK [UIDVALIDITY ${uidValidity}] UIDs valid\r\n`);
            socket.write(`* OK [UIDNEXT ${Math.max(1, ...messages.map(({ uid }) => uid + 1))}] next UID\r\n`);
            socket.write(`${tag} OK [READ-ONLY] ${command} completed\r\n`);
            break;
          case 'STATUS':
            socket.write(`* STATUS "INBOX" (MESSAGES ${messages.length} UIDNEXT ${messages.length + 1} UIDVALIDITY ${uidValidity} UNSEEN ${messages.length})\r\n`);
            socket.write(`${tag} OK STATUS completed\r\n`);
            break;
          case 'FETCH':
          case 'UID': {
            const fetchArgs = command.toUpperCase() === 'UID'
              ? args.replace(/^FETCH\s+/i, '')
              : args;
            const start = Number.parseInt(fetchArgs, 10) || 1;
            messages.forEach((message, index) => {
              if ((command.toUpperCase() === 'UID' ? message.uid : index + 1) < start) return;
              const subject = /^Subject:\s*(.+)$/im.exec(message.source)?.[1]?.trim() ?? 'No subject';
              const messageId = /^Message-ID:\s*(.+)$/im.exec(message.source)?.[1]?.trim() ?? `<${message.uid}@test>`;
              const bytes = Buffer.byteLength(message.source);
              socket.write(
                `* ${index + 1} FETCH (UID ${message.uid} ` +
                `INTERNALDATE "17-Jul-2026 12:00:00 +0000" ` +
                `ENVELOPE ("Fri, 17 Jul 2026 12:00:00 +0000" ${quoted(subject)} ` +
                `((NIL NIL "registrar" "stateu.edu")) ((NIL NIL "registrar" "stateu.edu")) ` +
                `((NIL NIL "student" "example.com")) NIL NIL NIL NIL ${quoted(messageId)}) ` +
                `BODY[] {${bytes}}\r\n${message.source})\r\n`,
              );
            });
            socket.write(`${tag} OK FETCH completed\r\n`);
            break;
          }
          case 'NOOP':
            socket.write(`${tag} OK NOOP completed\r\n`);
            break;
          case 'LOGOUT':
            socket.write('* BYE closing connection\r\n');
            socket.end(`${tag} OK LOGOUT completed\r\n`);
            break;
          default:
            socket.write(`${tag} OK ${command || 'command'} completed\r\n`);
        }
      }
    });
  });
  return {
    server,
    setUidValidity(value: number) {
      uidValidity = value;
    },
  };
}

function startSmtpSink(deliveries: string[]) {
  return createServer((socket: Socket) => {
    let buffer = '';
    let data: string[] | null = null;
    socket.write('220 localhost Redi integration SMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            deliveries.push(data.join('\r\n'));
            data = null;
            socket.write('250 2.0.0 queued\r\n');
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
        } else if (/^EHLO /i.test(line)) {
          socket.write('250-localhost\r\n250-PIPELINING\r\n250 AUTH PLAIN\r\n');
        } else if (/^AUTH PLAIN(?: |$)/i.test(line)) {
          socket.write('235 2.7.0 authenticated\r\n');
        } else if (/^DATA$/i.test(line)) {
          data = [];
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (/^QUIT$/i.test(line)) {
          socket.end('221 2.0.0 bye\r\n');
        } else {
          socket.write('250 2.0.0 OK\r\n');
        }
      }
    });
  });
}

let dataDir = '';
let imap: ReturnType<typeof startImapServer>;
let smtp: Server;
const deliveries: string[] = [];

beforeAll(async () => {
  dataDir = await setupTestEnv('redi-transports-');
  imap = startImapServer([
    { uid: 1, source: readFileSync('tests/fixtures/emails/junk.eml', 'utf8') },
    { uid: 2, source: readFileSync('tests/fixtures/emails/actionable.eml', 'utf8') },
  ]);
  smtp = startSmtpSink(deliveries);
  const [imapPort, smtpPort] = await Promise.all([
    listen(imap.server),
    listen(smtp),
  ]);
  const { updateSettings } = await import('../../src/server/settings');
  const { setSecret } = await import('../../src/server/secrets');
  await updateSettings({
    imap: {
      host: '127.0.0.1',
      port: imapPort,
      tls: false,
      username: 'student',
      mailbox: 'INBOX',
      enabled: true,
    },
    smtp: {
      host: '127.0.0.1',
      port: smtpPort,
      security: 'none',
      username: 'student',
      from_address: 'redi@example.com',
      personal_email: 'student@example.com',
      enabled: true,
    },
  });
  await setSecret('imap.password', 'test-password');
  await setSecret('smtp.password', 'test-password');
});

afterAll(async () => {
  await Promise.all([close(imap.server), close(smtp)]);
  await teardownTestEnv(dataDir);
});

describe('real email transports', () => {
  it('reads seeded mail and handles UIDVALIDITY changes through ImapFlow', async () => {
    const { createImapSource } = await import('../../src/server/email/imapClient');
    const source = createImapSource();
    const first = await source.fetchNew('INBOX', 0, null);
    expect(first.messages.map(({ subject }) => subject)).toEqual([
      expect.stringMatching(/hoodies|off/i),
      expect.stringMatching(/deadline|registration/i),
    ]);
    imap.setUidValidity(42);
    const rescanned = await source.fetchNew('INBOX', 2, first.uidvalidity);
    expect(rescanned).toMatchObject({ uidvalidity: 42, rescan: true });
  });

  it('sends a real message to an in-process SMTP sink', async () => {
    const { callTool } = await import('../../src/server/tools/call');
    const result = await callTool('test_smtp_connection', {}, { actor: 'user' });
    expect(result).toMatchObject({ ok: true, sent_to: 'student@example.com' });
    expect(deliveries.join('\n')).toContain('To: student@example.com');
  });
});

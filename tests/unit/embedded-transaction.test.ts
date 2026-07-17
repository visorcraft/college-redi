import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestEnv, resetServerState, type TestEnv } from '../helpers/env';

let env: TestEnv;

beforeEach(async () => {
  env = makeTestEnv();
  await resetServerState();
});

afterEach(async () => {
  await resetServerState();
  env.cleanup();
});

describe('embedded SQL transaction isolation', () => {
  it('queues unrelated statements until an open transaction finishes', async () => {
    const { lit, sqlExec, sqlRows, withSqlTransaction } = await import(
      '../../src/server/db/sql'
    );
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const release = new Promise<void>((resolve) => { finish = resolve; });

    const transaction = withSqlTransaction(async () => {
      await sqlExec(
        `INSERT INTO sender_rules (id, pattern, action, created_at) VALUES (` +
        `${lit('inside')}, ${lit('inside.example')}, 'junk', ${lit(new Date())})`,
      );
      entered();
      await release;
      throw new Error('rollback inside');
    });
    await started;
    const unrelated = sqlExec(
      `INSERT INTO sender_rules (id, pattern, action, created_at) VALUES (` +
      `${lit('outside')}, ${lit('outside.example')}, 'junk', ${lit(new Date())})`,
    );
    finish();

    await expect(transaction).rejects.toThrow('rollback inside');
    await unrelated;
    expect(await sqlRows<{ id: string }>(
      'SELECT id FROM sender_rules ORDER BY id',
    )).toEqual([{ id: 'outside' }]);
  });

  it('queues chat writes behind an unrelated transaction', async () => {
    const { sqlExec, withSqlTransaction } = await import('../../src/server/db/sql');
    const chat = await import('../../src/server/chat/store');
    const conversation = await chat.createConversation();
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const release = new Promise<void>((resolve) => { finish = resolve; });

    const transaction = withSqlTransaction(async () => {
      await sqlExec("UPDATE chat_conversations SET title = 'rolled back'");
      entered();
      await release;
      throw new Error('rollback');
    });
    await started;
    const append = chat.appendMessage({
      conversation_id: conversation.id,
      role: 'user',
      content: 'survives',
    });
    finish();

    await expect(transaction).rejects.toThrow('rollback');
    await append;
    expect((await chat.listMessages(conversation.id)).map(({ content }) => content))
      .toEqual(['survives']);
  });
});

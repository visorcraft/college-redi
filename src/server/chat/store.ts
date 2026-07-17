import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client';
import { sqlRows, sqlString } from './sql';

export interface ChatConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: string | null;
  created_at: string;
}

const nowIso = () => new Date().toISOString();

export async function createConversation(title = 'New chat'): Promise<ChatConversationRow> {
  const db = await getDb();
  const now = nowIso();
  const row = { id: randomUUID(), title, created_at: now, updated_at: now };
  await db.sql(
    `INSERT INTO chat_conversations (id, title, created_at, updated_at) VALUES (` +
    `${sqlString(row.id)}, ${sqlString(row.title)}, ${sqlString(row.created_at)}, ` +
    `${sqlString(row.updated_at)})`,
  );
  return row;
}

export async function listConversations(): Promise<ChatConversationRow[]> {
  return sqlRows<ChatConversationRow>(
    await getDb(),
    'SELECT id, title, created_at, updated_at FROM chat_conversations ' +
    'ORDER BY updated_at DESC, id DESC',
  );
}

export async function getConversation(id: string): Promise<ChatConversationRow | null> {
  const rows = await sqlRows<ChatConversationRow>(
    await getDb(),
    'SELECT id, title, created_at, updated_at FROM chat_conversations ' +
    `WHERE id = ${sqlString(id)}`,
  );
  return rows[0] ?? null;
}

export async function appendMessage(input: {
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: string | null;
  created_at?: string;
}): Promise<ChatMessageRow> {
  const db = await getDb();
  const row: ChatMessageRow = {
    id: randomUUID(),
    conversation_id: input.conversation_id,
    role: input.role,
    content: input.content,
    tool_calls: input.tool_calls ?? null,
    created_at: input.created_at ?? nowIso(),
  };
  await db.sql(
    `INSERT INTO chat_messages (` +
    `id, conversation_id, role, content, tool_calls, created_at` +
    `) VALUES (` +
    `${sqlString(row.id)}, ${sqlString(row.conversation_id)}, ${sqlString(row.role)}, ` +
    `${sqlString(row.content)}, ` +
    `${row.tool_calls === null ? 'NULL' : sqlString(row.tool_calls)}, ` +
    `${sqlString(row.created_at)})`,
  );
  return row;
}

export async function listMessages(
  conversationId: string,
  limit?: number,
): Promise<ChatMessageRow[]> {
  const cap = limit === undefined ? '' : ` LIMIT ${Math.max(1, Math.floor(limit))}`;
  const rows = await sqlRows<ChatMessageRow>(
    await getDb(),
    'SELECT id, conversation_id, role, content, tool_calls, created_at ' +
    `FROM chat_messages WHERE conversation_id = ${sqlString(conversationId)} ` +
    `ORDER BY created_at DESC, id DESC${cap}`,
  );
  return rows.reverse();
}

export async function touchConversation(id: string, title?: string): Promise<void> {
  const titleClause = title === undefined ? '' : `, title = ${sqlString(title)}`;
  await (await getDb()).sql(
    `UPDATE chat_conversations SET updated_at = ${sqlString(nowIso())}${titleClause} ` +
    `WHERE id = ${sqlString(id)}`,
  );
}

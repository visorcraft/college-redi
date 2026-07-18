import { randomUUID } from 'node:crypto';
import { lit, sqlExec, sqlRows } from '../db/sql';

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
  const now = nowIso();
  const row = { id: randomUUID(), title, created_at: now, updated_at: now };
  await sqlExec(
    `INSERT INTO chat_conversations (id, title, created_at, updated_at) VALUES (` +
    `${lit(row.id)}, ${lit(row.title)}, ${lit(row.created_at)}, ${lit(row.updated_at)})`,
  );
  return row;
}

export async function listConversations(limit = 100): Promise<ChatConversationRow[]> {
  return sqlRows<ChatConversationRow>(
    'SELECT id, title, created_at, updated_at FROM chat_conversations ' +
    `ORDER BY updated_at DESC, id DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
  );
}

export async function getConversation(id: string): Promise<ChatConversationRow | null> {
  const rows = await sqlRows<ChatConversationRow>(
    'SELECT id, title, created_at, updated_at FROM chat_conversations ' +
    `WHERE id = ${lit(id)}`,
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
  const row: ChatMessageRow = {
    id: randomUUID(),
    conversation_id: input.conversation_id,
    role: input.role,
    content: input.content,
    tool_calls: input.tool_calls ?? null,
    created_at: input.created_at ?? nowIso(),
  };
  await sqlExec(
    `INSERT INTO chat_messages (` +
    `id, conversation_id, role, content, tool_calls, created_at` +
    `) VALUES (` +
    `${lit(row.id)}, ${lit(row.conversation_id)}, ${lit(row.role)}, ` +
    `${lit(row.content)}, ${lit(row.tool_calls)}, ${lit(row.created_at)})`,
  );
  return row;
}

export async function listMessages(
  conversationId: string,
  limit = 200,
): Promise<ChatMessageRow[]> {
  const cap = ` LIMIT ${Math.max(1, Math.floor(limit))}`;
  const rows = await sqlRows<ChatMessageRow>(
    'SELECT id, conversation_id, role, content, tool_calls, created_at ' +
    `FROM chat_messages WHERE conversation_id = ${lit(conversationId)} ` +
    `ORDER BY created_at DESC, id DESC${cap}`,
  );
  return rows.reverse();
}

export async function touchConversation(id: string, title?: string): Promise<void> {
  const titleClause = title === undefined ? '' : `, title = ${lit(title)}`;
  await sqlExec(
    `UPDATE chat_conversations SET updated_at = ${lit(nowIso())}${titleClause} ` +
    `WHERE id = ${lit(id)}`,
  );
}

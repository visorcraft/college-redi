import type OpenAI from 'openai';
import { isDeepStrictEqual } from 'node:util';
import * as store from '../chat/store';
import { getSettings } from '../settings';
import { callTool } from '../tools/call';
import { listTools } from '../tools/registry';
import { getAiClient } from './client';

export type AgentEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'done'; text: string };

export const MAX_TOOL_ROUNDS = 8;
const HISTORY_WINDOW = 20;
const TOOL_RESULT_MAX_CHARS = 4000;
const REDI_CTX = { actor: 'redi' };
const summaryCache = new Map<string, { count: number; text: string }>();

const CONFIRM_ASK =
  /\b(confirm|are you sure|shall i|should i|do you want me to|reply (with )?yes)\b/i;
const AFFIRMATIVE =
  /^\s*(yes|yep|yeah|y|sure|ok|okay|confirm|confirmed|do it|go ahead|proceed|delete it|remove it|yes please|yes,? do it)[.!]?\s*$/i;
const CONFIRM_PREFIX = '<!-- redi-confirm:';
const CONFIRM_SUFFIX = '-->';

interface DestructiveAuthorization {
  tool: string;
  arguments: Record<string, unknown>;
}

export function shouldArmDestructive(
  previousAssistant: string | null,
  userText: string,
): boolean {
  return destructiveAuthorization(previousAssistant, userText) !== null;
}

function destructiveAuthorization(
  previousAssistant: string | null,
  userText: string,
): DestructiveAuthorization | null {
  if (
    previousAssistant === null
    || !CONFIRM_ASK.test(previousAssistant)
    || !AFFIRMATIVE.test(userText)
  ) return null;
  const start = previousAssistant.lastIndexOf(CONFIRM_PREFIX);
  const end = previousAssistant.indexOf(
    CONFIRM_SUFFIX,
    start + CONFIRM_PREFIX.length,
  );
  if (start < 0 || end < 0) return null;
  try {
    const value = JSON.parse(previousAssistant.slice(
      start + CONFIRM_PREFIX.length,
      end,
    )) as DestructiveAuthorization;
    const tool = listTools().find((candidate) => candidate.name === value.tool);
    return tool?.sideEffect === 'destructive'
      && value.arguments
      && typeof value.arguments === 'object'
      && !Array.isArray(value.arguments)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function buildSystemPrompt(
  now: Date,
  timezone: string,
  snapshot: string,
  summary: string | null,
): string {
  const stamp = now.toLocaleString('en-US', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const parts = [
    'You are Redi, a small floating navy-blue cloud with beautiful eyes, the warm, upbeat assistant inside the Redi degree-planning app.',
    'Voice: warm, upbeat, encouraging, concise; second person, present tense. Celebrate wins, nudge gently without guilt, never shame, never use jargon; explain anything technical in one friendly sentence.',
    'Emoji budget: at most ONE emoji per message, weather-themed preferred (☁️ 🌤️ ⛅); 🎉 only for real milestones.',
    `Current date/time: ${stamp} (${timezone}).`,
    `Student snapshot (fetched fresh for this turn):\n${snapshot}`,
    'Rules:',
    '- Always prefer calling tools over memory for facts about the student. Never invent dates, deadlines, amounts, or course codes; read them from tools.',
    '- Before a destructive tool, describe exactly what and which record you would delete/revoke, ask for confirmation, then end with this exact hidden marker using real tool arguments: <!-- redi-confirm:{"tool":"tool_name","arguments":{"id":"record-id"}} -->',
    '- A confirmation authorizes only that exact tool call once. Never change its arguments after asking.',
    '- Keep answers under ~120 words unless the user asks for detail.',
    '- If no tool can answer something, say so plainly instead of guessing.',
  ];
  if (summary) parts.push(`Summary of the earlier conversation:\n${summary}`);
  return parts.join('\n');
}

function asArray(value: unknown, key: string): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (value && typeof value === 'object') {
    const nested = (value as Record<string, unknown>)[key];
    if (Array.isArray(nested)) return nested as Array<Record<string, unknown>>;
  }
  return [];
}

function objectAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === 'object'
    ? nested as Record<string, unknown>
    : undefined;
}

export async function buildStudentSnapshot(): Promise<string> {
  const lines: string[] = [];
  try {
    const programs = asArray(await callTool('list_programs', {}, REDI_CTX), 'programs');
    const active = programs.find((program) => program.status === 'active') ?? programs[0];
    if (active) lines.push(`Program: ${active.name} at ${active.institution}`);
  } catch {
    // New accounts may not have a program.
  }
  try {
    const progress = await callTool('get_degree_progress', {}, REDI_CTX);
    const direct = progress && typeof progress === 'object'
      ? progress as Record<string, unknown>
      : {};
    const percent = objectAt(progress, 'overall')?.percent
      ?? direct.percent
      ?? direct.percent_complete;
    if (typeof percent === 'number') {
      lines.push(`Degree progress: ${Math.round(percent)}%`);
    }
  } catch {
    // Progress needs an active program.
  }
  try {
    const tasks = asArray(
      await callTool('list_tasks', { status: 'pending' }, REDI_CTX),
      'tasks',
    );
    const next = tasks
      .filter((task) => typeof task.due_at === 'string' && task.due_at)
      .sort((left, right) => String(left.due_at).localeCompare(String(right.due_at)))
      .slice(0, 5);
    if (next.length) {
      lines.push(`Next deadlines: ${next.map((task) =>
        `${task.title} (${String(task.due_at).slice(0, 10)})`,
      ).join('; ')}`);
    }
  } catch {
    // Tasks can be unavailable during initial setup.
  }
  try {
    const notifications = await callTool(
      'list_notifications',
      { unread_only: true, limit: 500 },
      REDI_CTX,
    );
    const unreadCount = notifications && typeof notifications === 'object'
      ? (notifications as Record<string, unknown>).unread_count
      : undefined;
    lines.push(`Unread notifications: ${
      typeof unreadCount === 'number'
        ? unreadCount
        : asArray(notifications, 'notifications').length
    }`);
  } catch {
    // Notifications are optional snapshot context.
  }
  return lines.length ? lines.join('\n') : 'No student data yet; brand-new account.';
}

function projectTools(authorization: DestructiveAuthorization | null) {
  return listTools()
    .filter((tool) => tool.sideEffect !== 'destructive'
      || tool.name === authorization?.tool)
    .map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.jsonSchema,
      },
    }));
}

interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

async function executeToolCall(
  call: PendingToolCall,
  authorization: DestructiveAuthorization | null,
): Promise<{ text: string; consumed: boolean }> {
  let parsed: unknown;
  try {
    parsed = call.args ? JSON.parse(call.args) : {};
  } catch {
    return {
      text: `Error: invalid JSON arguments for ${call.name}; ask the model to retry.`,
      consumed: false,
    };
  }
  const params = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const tool = listTools().find((candidate) => candidate.name === call.name);
  if (!tool) return { text: `Error: unknown tool ${call.name}.`, consumed: false };

  let effectiveParams = params;
  let consumed = false;
  if (tool.sideEffect === 'destructive') {
    if (
      authorization?.tool !== call.name
      || !isDeepStrictEqual(params, authorization.arguments)
    ) {
      return {
        text: `Error: ${call.name} arguments do not match the user's confirmation. Ask again with the exact operation.`,
        consumed: false,
      };
    }
    consumed = true;
    effectiveParams = { ...params, confirm: true };
  }
  try {
    const result = await callTool(call.name, effectiveParams, REDI_CTX);
    let text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
    if (text.length > TOOL_RESULT_MAX_CHARS) {
      text = `${text.slice(0, TOOL_RESULT_MAX_CHARS)}…(trimmed)`;
    }
    return { text, consumed };
  } catch (error) {
    return {
      text: `Error from ${call.name}: ${error instanceof Error ? error.message : String(error)}`,
      consumed,
    };
  }
}

type CompletionClient = Awaited<ReturnType<typeof getAiClient>>['client'];
type CompletionChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

async function streamCompletion(
  client: CompletionClient,
  body: Record<string, unknown>,
  onDelta: (text: string) => void,
): Promise<{ text: string; toolCalls: PendingToolCall[] }> {
  let pending = '';
  let markerStarted = false;
  const emitVisible = (chunk: string, flush = false) => {
    if (markerStarted) return;
    pending += chunk;
    const marker = pending.indexOf(CONFIRM_PREFIX);
    if (marker >= 0) {
      onDelta(pending.slice(0, marker));
      pending = '';
      markerStarted = true;
      return;
    }
    const keep = flush ? 0 : CONFIRM_PREFIX.length - 1;
    if (pending.length > keep) {
      onDelta(pending.slice(0, pending.length - keep));
      pending = pending.slice(-keep);
    }
  };
  const stream = await client.chat.completions.create({
    ...body,
    stream: true,
  } as never) as unknown as AsyncIterable<CompletionChunk>;
  let text = '';
  const calls = new Map<number, PendingToolCall>();
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      emitVisible(delta.content);
    }
    for (const toolCall of delta.tool_calls ?? []) {
      const index = typeof toolCall.index === 'number' ? toolCall.index : 0;
      const current = calls.get(index) ?? { id: '', name: '', args: '' };
      if (toolCall.id) current.id = toolCall.id;
      if (toolCall.function?.name) current.name += toolCall.function.name;
      if (toolCall.function?.arguments) current.args += toolCall.function.arguments;
      calls.set(index, current);
    }
  }
  emitVisible('', true);
  return {
    text,
    toolCalls: [...calls.values()].filter((call) => call.name),
  };
}

function visibleAssistantText(text: string): string {
  const marker = text.indexOf(CONFIRM_PREFIX);
  return (marker < 0 ? text : text.slice(0, marker)).trimEnd();
}

function toOpenAiHistory(
  rows: store.ChatMessageRow[],
): Array<Record<string, unknown>> {
  return rows.map((message) => {
    if (message.role === 'tool') {
      const metadata = message.tool_calls
        ? JSON.parse(message.tool_calls) as Array<{ id: string }>
        : [];
      return {
        role: 'tool',
        tool_call_id: metadata[0]?.id ?? 'call_unknown',
        content: message.content,
      };
    }
    if (message.role === 'assistant' && message.tool_calls) {
      const calls = JSON.parse(message.tool_calls) as Array<{
        id: string;
        name: string;
        arguments: string;
      }>;
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

async function runningSummary(
  conversationId: string,
  history: store.ChatMessageRow[],
  client: CompletionClient,
  model: string,
): Promise<string | null> {
  if (history.length <= HISTORY_WINDOW) return null;
  const older = history.slice(0, -HISTORY_WINDOW);
  const cached = summaryCache.get(conversationId) ?? { count: 0, text: '' };
  if (cached.count >= older.length) return cached.text || null;
  const transcript = older.slice(cached.count)
    .map((message) => `${message.role}: ${message.content.slice(0, 200)}`)
    .join('\n');
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'Compress chat history into a running summary of at most 5 lines. Keep facts, dates, decisions, and open questions. Reply with the summary only.',
        },
        {
          role: 'user',
          content: `Previous summary:\n${cached.text || '(none)'}\n\n` +
            `New messages to fold in:\n${transcript}`,
        },
      ],
    } as never) as unknown as {
      choices: Array<{ message?: { content?: string | null } }>;
    };
    const text = String(response.choices[0]?.message?.content ?? '').trim() || cached.text;
    summaryCache.set(conversationId, { count: older.length, text });
    return text || null;
  } catch {
    summaryCache.set(conversationId, { count: older.length, text: cached.text });
    return cached.text || null;
  }
}

export async function runAgentTurn(
  conversationId: string,
  userText: string,
  onEvent: (event: AgentEvent) => void,
): Promise<{ text: string }> {
  const conversation = await store.getConversation(conversationId);
  if (!conversation) {
    throw new Error(`chat conversation not found: ${conversationId}`);
  }
  const { client, model, effort } = await getAiClient();
  const history = await store.listMessages(conversationId);
  const previousAssistant = [...history].reverse()
    .find((message) => message.role === 'assistant');
  let authorization = destructiveAuthorization(
    previousAssistant?.content ?? null,
    userText,
  );
  const summary = await runningSummary(conversationId, history, client, model);
  const { timezone } = await getSettings();
  const system = buildSystemPrompt(
    new Date(),
    timezone || 'UTC',
    await buildStudentSnapshot(),
    summary,
  );
  await store.appendMessage({
    conversation_id: conversationId,
    role: 'user',
    content: userText,
    tool_calls: null,
  });
  if (conversation.title === 'New chat') {
    await store.touchConversation(conversationId, userText.slice(0, 60));
  }

  let messages: Array<Record<string, unknown>> = [
    { role: 'system', content: system },
    ...toOpenAiHistory(history.slice(-HISTORY_WINDOW)),
    { role: 'user', content: userText },
  ];
  let rounds = 0;
  let finalText = '';
  for (;;) {
    const body: Record<string, unknown> = {
      model,
      messages,
      reasoning_effort: effort,
    };
    const tools = projectTools(authorization);
    if (tools.length) body.tools = tools;
    const completion = await streamCompletion(
      client,
      body,
      (text) => onEvent({ type: 'delta', text }),
    );
    if (completion.toolCalls.length === 0) {
      finalText = visibleAssistantText(completion.text);
      await store.appendMessage({
        conversation_id: conversationId,
        role: 'assistant',
        content: completion.text,
        tool_calls: null,
      });
      break;
    }

    rounds += 1;
    const persistedCalls = completion.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.args,
    }));
    await store.appendMessage({
      conversation_id: conversationId,
      role: 'assistant',
      content: completion.text,
      tool_calls: JSON.stringify(persistedCalls),
    });
    messages = [...messages, {
      role: 'assistant',
      content: completion.text || null,
      tool_calls: persistedCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    }];
    for (const call of completion.toolCalls) {
      onEvent({ type: 'tool_start', name: call.name });
      const execution = await executeToolCall(call, authorization);
      if (execution.consumed) authorization = null;
      onEvent({ type: 'tool_end', name: call.name });
      await store.appendMessage({
        conversation_id: conversationId,
        role: 'tool',
        content: execution.text,
        tool_calls: JSON.stringify([{ id: call.id, name: call.name }]),
      });
      messages = [...messages, {
        role: 'tool',
        tool_call_id: call.id,
        content: execution.text,
      }];
    }
    if (rounds >= MAX_TOOL_ROUNDS) {
      const forced = await streamCompletion(
        client,
        { model, messages, reasoning_effort: effort },
        (text) => onEvent({ type: 'delta', text }),
      );
      finalText = visibleAssistantText(forced.text);
      await store.appendMessage({
        conversation_id: conversationId,
        role: 'assistant',
        content: forced.text,
        tool_calls: null,
      });
      break;
    }
  }
  await store.touchConversation(conversationId);
  onEvent({ type: 'done', text: finalText });
  return { text: finalText };
}

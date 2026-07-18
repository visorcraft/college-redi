'use client';

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { renderMarkdownLite } from './markdownLite';
import { toolActivityLine } from './rediText';

const THINK_RE = /<think>[\s\S]*?(?:<\/think>|$)/g;
function stripThinking(text: string): string {
  return text.replace(THINK_RE, '').replace(/<\/think>/g, '').trim();
}

export interface ChatBubbleProps {
  open: boolean;
  aiConfigured: boolean;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}

interface UiMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

const SUGGESTED_PROMPTS = [
  'What did my college email say today?',
  'Am I on track to graduate?',
  'What do I still owe the bursar?',
];

const CELEBRATE_TOOLS = new Set([
  'complete_task',
  'mark_course_completed',
  'update_planned_course',
  'accept_event',
]);

function csrfHeader(): Record<string, string> {
  const match = document.cookie.match(/(?:^|;\s*)redi_csrf=([^;]+)/);
  return match
    ? { 'x-csrf-token': decodeURIComponent(match[1]) }
    : {};
}

function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...csrfHeader(),
      ...(init.headers ?? {}),
    },
  });
}

export function ChatBubble({
  open,
  aiConfigured,
  onClose,
  onBusyChange,
  returnFocusRef,
}: ChatBubbleProps) {
  const [view, setView] = useState<'chat' | 'list'>('chat');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusyState] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sleepyActionRef = useRef<HTMLAnchorElement>(null);
  const wasOpen = useRef(false);

  const setBusy = useCallback((next: boolean) => {
    setBusyState(next);
    onBusyChange(next);
    if (!next) setActivity(null);
  }, [onBusyChange]);

  const loadConversations = useCallback(async () => {
    const response = await apiFetch('/api/chat/conversations');
    if (!response.ok) return;
    const data = await response.json();
    const items = (data.conversations ?? []) as ConversationSummary[];
    setConversations(items);
    return items;
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const response = await apiFetch(`/api/chat/conversations/${id}`);
    if (!response.ok) return;
    const data = await response.json();
    setMessages(
      (data.messages as Array<{ role: string; content: string }>)
        .filter((message) =>
          (message.role === 'user' || message.role === 'assistant')
          && message.content.trim().length > 0)
        .map((message) => ({
          role: message.role as UiMessage['role'],
          content: message.role === 'assistant' ? stripThinking(message.content) : message.content,
        })),
    );
  }, []);

  useEffect(() => {
    if (!open || !aiConfigured) return;
    void (async () => {
      const items = await loadConversations();
      if (items?.[0]) {
        setActiveId(items[0].id);
        await loadMessages(items[0].id);
      }
    })();
  }, [open, aiConfigured, loadConversations, loadMessages]);

  useEffect(() => {
    if (open) {
      (aiConfigured ? inputRef.current : sleepyActionRef.current)?.focus();
    }
  }, [open, aiConfigured, activeId, busy]);

  useEffect(() => {
    if (!open && wasOpen.current) returnFocusRef.current?.focus();
    wasOpen.current = open;
  }, [open, returnFocusRef]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, activity]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const patchLastAssistant = (patch: (content: string) => string) => {
    setMessages((current) => {
      const copy = [...current];
      const last = copy[copy.length - 1];
      if (last?.role === 'assistant') {
        copy[copy.length - 1] = {
          ...last,
          content: patch(last.content),
        };
      }
      return copy;
    });
  };

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setErrorText(null);
    setInput('');
    setMessages((current) => [
      ...current,
      { role: 'user', content: message },
      { role: 'assistant', content: '' },
    ]);
    setBusy(true);

    try {
      let id = activeId;
      if (!id) {
        const createResponse = await apiFetch('/api/chat/conversations', {
          method: 'POST',
          body: '{}',
        });
        if (!createResponse.ok) throw new Error('Redi could not start a new chat.');
        id = (await createResponse.json()).id as string;
        setActiveId(id);
      }

      const response = await apiFetch(
        `/api/chat/conversations/${id}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ message }),
        },
      );
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.error?.message ?? 'Redi could not answer right now.',
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let ephemeralText = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const raw = /^data: (.*)$/m.exec(block)?.[1];
          if (!event || !raw) continue;
          const data = JSON.parse(raw);
          if (event === 'delta') {
            const visible = stripThinking(data.text);
            if (visible) patchLastAssistant((content) => content + visible);
          } else if (event === 'tool') {
            setActivity(
              data.phase === 'start' ? toolActivityLine(data.name) : null,
            );
            if (
              data.phase === 'end'
              && CELEBRATE_TOOLS.has(data.name)
            ) {
              window.dispatchEvent(new CustomEvent('redi:celebrate'));
            }
          } else if (
            event === 'ephemeral'
            && data.name === 'create_mcp_token'
            && typeof data.result?.token === 'string'
          ) {
            ephemeralText =
              `\n\nMCP token, shown once:\n\`${data.result.token}\``;
            patchLastAssistant((content) => content + ephemeralText);
          } else if (event === 'done') {
            patchLastAssistant(() => stripThinking(data.text) + ephemeralText);
          } else if (event === 'error') {
            setErrorText(String(data.message));
          }
        }
      }
      void loadConversations();
    } catch (error) {
      setMessages((current) => current.slice(0, -1));
      setErrorText(
        error instanceof Error ? error.message : 'Redi hit a snag - try again.',
      );
    } finally {
      setBusy(false);
    }
  }, [activeId, busy, loadConversations, setBusy]);

  if (!open) return null;

  if (!aiConfigured) {
    return (
      <div
        id="redi-chat"
        role="dialog"
        aria-label="Chat with Redi"
        className="fixed bottom-24 right-6 z-50 flex w-80 flex-col gap-3 rounded-[2rem] rounded-br-md border border-slate-200 bg-white p-5 shadow-xl"
      >
        <p className="text-sm text-[#1F2D50]">
          Redi can talk to you once you add your AI credentials and pick a model
        </p>
        <a
          ref={sleepyActionRef}
          href="/settings"
          className="rounded-full bg-[#1F2D50] px-4 py-2 text-center text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
        >
          Set up Redi&apos;s AI brain
        </a>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 underline focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
        >
          Maybe later
        </button>
      </div>
    );
  }

  return (
    <div
      id="redi-chat"
      role="dialog"
      aria-label="Chat with Redi"
      className="fixed bottom-24 right-6 z-50 flex h-[32rem] w-96 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[2rem] rounded-br-md border border-slate-200 bg-white shadow-xl"
    >
      <div className="flex items-center justify-between bg-[#1F2D50] px-4 py-2.5 text-white">
        <span className="text-sm font-semibold">Redi</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Show conversations"
            onClick={() => setView(view === 'list' ? 'chat' : 'list')}
            className="rounded-full px-2 py-1 text-xs hover:bg-[#2E416E] focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
          >
            Chats
          </button>
          <button
            type="button"
            aria-label="Close chat"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-xs hover:bg-[#2E416E] focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
          >
            ✕
          </button>
        </div>
      </div>

      {view === 'list' ? (
        <div className="flex-1 overflow-y-auto p-3">
          <button
            type="button"
            onClick={() => {
              setActiveId(null);
              setMessages([]);
              setView('chat');
            }}
            className="mb-2 w-full rounded-xl bg-[#1F2D50] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
          >
            + New chat
          </button>
          <ul aria-label="Past conversations" className="space-y-1">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveId(conversation.id);
                    setView('chat');
                    void loadMessages(conversation.id);
                  }}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm text-[#1F2D50] hover:bg-[#EAF3FB] focus:outline-none focus:ring-2 focus:ring-[#FFC24B] ${
                    conversation.id === activeId ? 'bg-[#EAF3FB]' : ''
                  }`}
                >
                  {conversation.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-label="Conversation"
            className="flex-1 space-y-3 overflow-y-auto bg-[#EAF3FB] p-3"
          >
            {messages.length === 0 && !busy && (
              <div className="space-y-2 pt-2">
                <p className="text-center text-xs text-slate-500">
                  Ask Redi anything, or try:
                </p>
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-[#1F2D50] shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.role === 'user'
                    ? 'ml-8 rounded-2xl rounded-br-md bg-[#1F2D50] px-3 py-2 text-sm text-white'
                    : 'mr-8 rounded-[1.5rem] rounded-bl-md bg-white px-3 py-2 text-sm text-[#1F2D50] shadow-sm'
                }
              >
                {message.role === 'assistant'
                  ? renderMarkdownLite(message.content)
                  : message.content}
              </div>
            ))}
            {activity && (
              <p className="text-xs italic text-slate-500" role="status">
                {activity}
              </p>
            )}
            {errorText && (
              <p className="text-xs text-red-600" role="alert">
                {errorText}
              </p>
            )}
          </div>
          <form
            className="flex items-center gap-2 border-t border-slate-200 bg-white p-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <label htmlFor="redi-chat-input" className="sr-only">
              Message Redi
            </label>
            <input
              id="redi-chat-input"
              data-testid="chat-input"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={busy}
              placeholder={busy ? 'Redi is thinking…' : 'Ask Redi…'}
              className="flex-1 rounded-full border border-slate-300 px-3 py-2 text-sm text-[#1F2D50] focus:outline-none focus:ring-2 focus:ring-[#FFC24B] disabled:opacity-60"
            />
            <button
              type="submit"
              data-testid="chat-send"
              disabled={busy || !input.trim()}
              aria-label="Send message"
              className="rounded-full bg-[#1F2D50] px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-[#FFC24B] disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default ChatBubble;

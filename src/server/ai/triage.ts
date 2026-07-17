import { z } from 'zod';
import { getAiClient } from './client';

export interface TriageInput {
  from: string;
  subject: string;
  date: string;
  bodyText: string;
}

export const triageEventSchema = z.object({
  title: z.string().min(1).max(300),
  event_type: z.enum(['deadline', 'registration', 'appointment', 'payment', 'general']),
  due_at: z.string().nullable().refine(
    (value) => value === null || !Number.isNaN(Date.parse(value)),
    'due_at must be ISO 8601 or null',
  ),
  confidence: z.number().min(0).max(1),
});

export const triageResultSchema = z.object({
  classification: z.enum(['junk', 'informational', 'actionable']),
  summary: z.string().min(1).max(1200),
  importance: z.enum(['low', 'normal', 'urgent']),
  events: z.array(triageEventSchema).max(10),
  rationale: z.string().max(1200),
});

export type TriageResult = z.infer<typeof triageResultSchema>;
export type TriageOutcome =
  | { ok: true; result: TriageResult }
  | { ok: false; error: string };

export interface TriageCompleter {
  complete(system: string, user: string): Promise<string>;
}

const BODY_LIMIT = 4000;
const BATCH_SIZE = 10;

const batchResponseSchema = z.object({
  results: z.array(triageResultSchema.extend({
    index: z.number().int().min(0),
  })),
});

export function buildTriagePrompt(
  messages: TriageInput[],
  timezone: string,
  now: Date,
): { system: string; user: string } {
  const system = [
    'You are Redi\'s email triage engine for a college student. Classify each email and extract what matters.',
    `The student's timezone is ${timezone}. Today is ${now.toISOString().slice(0, 10)}; interpret all dates and deadlines in that timezone relative to that date.`,
    'Classification rules:',
    '- junk: marketing, newsletters, spam, generic campus blasts with no personal action.',
    '- actionable: personally addressed; contains a deadline, request, or registration/financial-aid/housing action; or from a registrar/professor/advisor about this student.',
    '- informational: worth one digest line, no action needed.',
    'For each email return: classification; a 1-3 sentence plain-language summary; importance (low|normal|urgent); events (deadlines, dates, requested actions) each with title, event_type (deadline|registration|appointment|payment|general), due_at (ISO 8601 with timezone offset, or null when the date is ambiguous or missing; never guess), confidence (0-1); and a one-line rationale.',
    'Reply with STRICT JSON only, no markdown fences, exactly: {"results":[{"index":0,"classification":"...","summary":"...","importance":"...","events":[{"title":"...","event_type":"...","due_at":null,"confidence":0.5}],"rationale":"..."}]}',
    'The index must match the input message index.',
  ].join('\n');
  const user = messages.map((message, index) => [
    `--- MESSAGE ${index} ---`,
    `From: ${message.from}`,
    `Subject: ${message.subject}`,
    `Date: ${message.date}`,
    'Body:',
    message.bodyText.slice(0, BODY_LIMIT),
  ].join('\n')).join('\n\n');
  return { system, user };
}

function extractJson(raw: string): unknown {
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  return JSON.parse(cleaned);
}

function openAiCompleter(): TriageCompleter {
  return {
    async complete(system, user) {
      const { client, model, effort } = await getAiClient();
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        reasoning_effort: effort,
        timeout: 60_000,
      } as never);
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('AI returned an empty response');
      return content;
    },
  };
}

async function triageBatch(
  messages: TriageInput[],
  completer: TriageCompleter,
  timezone: string,
  now: Date,
): Promise<TriageOutcome[]> {
  const prompt = buildTriagePrompt(messages, timezone, now);
  let user = prompt.user;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await completer.complete(prompt.system, user);
    try {
      const parsed = batchResponseSchema.parse(extractJson(raw));
      return messages.map((_, index) => {
        const hit = parsed.results.find((result) => result.index === index)
          ?? parsed.results[index];
        if (!hit) return { ok: false, error: `no result for index ${index}` };
        return { ok: true, result: triageResultSchema.parse(hit) };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        return messages.map(() => ({
          ok: false,
          error: `invalid triage response: ${message.slice(0, 200)}`,
        }));
      }
      user = `${user}\n\nYour previous reply was not valid for the required schema ` +
        `(${message.slice(0, 300)}). Reply again with strict JSON only.`;
    }
  }
  throw new Error('unreachable');
}

export async function triageMessages(
  messages: TriageInput[],
  options: { completer?: TriageCompleter; timezone: string; now: Date },
): Promise<TriageOutcome[]> {
  const completer = options.completer ?? openAiCompleter();
  const outcomes: TriageOutcome[] = [];
  for (let index = 0; index < messages.length; index += BATCH_SIZE) {
    outcomes.push(...await triageBatch(
      messages.slice(index, index + BATCH_SIZE),
      completer,
      options.timezone,
      options.now,
    ));
  }
  return outcomes;
}

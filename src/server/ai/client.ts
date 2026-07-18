import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { lit, sqlExec, sqlRows } from '../db/sql';
import { getSecret } from '../secrets';
import { getSettings } from '../settings';

export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI is not configured. Add an API key (ai.api_key) via the wizard or Settings.');
    this.name = 'AiNotConfiguredError';
  }
}

export class AiDailyCapExceededError extends Error {
  constructor(cap: number) {
    super(`Daily AI call cap reached (${cap}). AI work resumes tomorrow.`);
    this.name = 'AiDailyCapExceededError';
  }
}

export interface AiClientHandle {
  client: OpenAI;
  model: string;
  effort: 'low' | 'medium' | 'high';
}

export interface AiClientOverrides {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

let usageQueue = Promise.resolve();

function dayInTimezone(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

async function usageRow(now = new Date()): Promise<{
  key: string;
  count: number;
  cap: number;
}> {
  const settings = await getSettings();
  const day = dayInTimezone(now, settings.timezone || 'UTC');
  const key = `ai_calls:${day}`;
  const row = (await sqlRows<{ last_status: string }>(
    `SELECT last_status FROM job_leases WHERE job_name = ${lit(key)}`,
  ))[0];
  return {
    key,
    count: Number.parseInt(row?.last_status ?? '0', 10) || 0,
    cap: settings.ai.daily_cap ?? 500,
  };
}

async function reserveAiCall(): Promise<void> {
  const reservation = usageQueue.then(async () => {
    const usage = await usageRow();
    if (usage.count >= usage.cap) {
      throw new AiDailyCapExceededError(usage.cap);
    }
    const next = usage.count + 1;
    const now = new Date();
    const exists = await sqlRows<{ job_name: string }>(
      `SELECT job_name FROM job_leases WHERE job_name = ${lit(usage.key)}`,
    );
    if (exists.length > 0) {
      await sqlExec(
        `UPDATE job_leases SET last_status = ${lit(String(next))}, ` +
        `last_run_at = ${lit(now)}, locked_until = ${lit(new Date(now.getTime() + 2 * 86_400_000))} ` +
        `WHERE job_name = ${lit(usage.key)}`,
      );
    } else {
      await sqlExec(
        `INSERT INTO job_leases (` +
        `job_name, locked_until, last_run_at, last_status` +
        `) VALUES (` +
        `${lit(usage.key)}, ${lit(new Date(now.getTime() + 2 * 86_400_000))}, ` +
        `${lit(now)}, ${lit(String(next))})`,
      );
    }
  });
  usageQueue = reservation.then(() => undefined, () => undefined);
  return reservation;
}

export async function getAiUsageStatus(now = new Date()): Promise<{
  callsToday: number;
  dailyCap: number;
}> {
  const usage = await usageRow(now);
  return { callsToday: usage.count, dailyCap: usage.cap };
}

function promptHash(body: unknown): string {
  const messages = body && typeof body === 'object'
    ? (body as Record<string, unknown>).messages
    : null;
  return createHash('sha256')
    .update(JSON.stringify(messages ?? null))
    .digest('hex');
}

function usageFrom(value: unknown): Usage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = (value as Record<string, unknown>).usage;
  return usage && typeof usage === 'object' ? usage as Usage : undefined;
}

function logAiCall(hash: string, usage?: Usage): void {
  console.info(JSON.stringify({
    level: 'info',
    msg: 'ai completion',
    prompt_hash: hash,
    prompt_tokens: usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    total_tokens: usage?.total_tokens ?? null,
  }));
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value
    && typeof value === 'object'
    && Symbol.asyncIterator in value,
  );
}

async function* loggedStream(
  stream: AsyncIterable<unknown>,
  hash: string,
): AsyncGenerator<unknown> {
  let usage: Usage | undefined;
  try {
    for await (const chunk of stream) {
      usage = usageFrom(chunk) ?? usage;
      yield chunk;
    }
    logAiCall(hash, usage);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'ai completion failed',
      prompt_hash: hash,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}

function instrument(client: OpenAI): OpenAI {
  type Create = typeof client.chat.completions.create;
  type Args = Parameters<Create>;
  const raw = client.chat.completions.create.bind(
    client.chat.completions,
  ) as unknown as (...args: Args) => Promise<unknown>;
  const create = async (...args: Args): Promise<unknown> => {
    await reserveAiCall();
    const body = args[0] as unknown as Record<string, unknown>;
    if (body.stream) {
      args[0] = {
        ...body,
        stream_options: {
          ...(body.stream_options as Record<string, unknown> | undefined),
          include_usage: true,
        },
      } as Args[0];
    }
    const hash = promptHash(args[0]);
    try {
      const result = await raw(...args);
      if (isAsyncIterable(result)) return loggedStream(result, hash);
      logAiCall(hash, usageFrom(result));
      return result;
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'ai completion failed',
        prompt_hash: hash,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  };
  client.chat.completions.create = create as unknown as Create;
  return client;
}

export async function getAiClient(overrides: AiClientOverrides = {}): Promise<AiClientHandle> {
  const apiKey = overrides.apiKey ?? await getSecret('ai.api_key');
  if (apiKey === null) throw new AiNotConfiguredError();
  const settings = await getSettings();
  return {
    client: instrument(new OpenAI({
      apiKey,
      baseURL: overrides.baseURL ?? settings.ai.base_url,
      defaultHeaders: settings.ai.extra_headers,
      maxRetries: 1,
      timeout: 60_000,
    })),
    model: overrides.model ?? settings.ai.model,
    effort: overrides.effort ?? settings.ai.effort,
  };
}

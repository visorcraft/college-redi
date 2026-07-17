import { describe, expect, it } from 'vitest';
import {
  buildTriagePrompt,
  triageMessages,
  type TriageCompleter,
} from '../../src/server/ai/triage';
import {
  actionableResultJson,
  ambiguousDateResultJson,
  junkResultJson,
  malformedThenFixed,
} from '../fixtures/ai/triageFixtures';

const message = (
  overrides: Partial<{ from: string; subject: string; bodyText: string }> = {},
) => ({
  from: overrides.from ?? 'registrar@stateu.edu',
  subject: overrides.subject ?? 'Registration closes Friday',
  date: '2026-07-14T13:30:00.000Z',
  bodyText: overrides.bodyText ?? 'Body text here.',
});

type RecordingCompleter = TriageCompleter & {
  calls: Array<{ system: string; user: string }>;
};

function completer(script: string[]): RecordingCompleter {
  const calls: RecordingCompleter['calls'] = [];
  return {
    calls,
    async complete(system, user) {
      calls.push({ system, user });
      return script[Math.min(calls.length - 1, script.length - 1)] ?? '';
    },
  };
}

describe('triageMessages', () => {
  it('parses a strict-JSON batch result aligned by index', async () => {
    const result = (await triageMessages([message()], {
      completer: completer([actionableResultJson]),
      timezone: 'America/New_York',
      now: new Date('2026-07-17T12:00:00Z'),
    }))[0];
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.classification).toBe('actionable');
      expect(result.result.events[0].due_at).toBe('2026-07-24T17:00:00-04:00');
      expect(result.result.events[0].confidence).toBe(0.97);
    }
  });

  it('retries once with the validation error after malformed JSON', async () => {
    const recording = completer(malformedThenFixed);
    const result = (await triageMessages([message()], {
      completer: recording,
      timezone: 'UTC',
      now: new Date(),
    }))[0];
    expect(recording.calls).toHaveLength(2);
    expect(recording.calls[1].user).toContain('not valid');
    expect(result.ok).toBe(true);
  });

  it('returns ok:false when a result fails validation', async () => {
    const invalid = JSON.stringify({
      results: [{
        index: 0,
        classification: 'junk',
        summary: 'x',
        importance: 'HIGH',
        events: [],
        rationale: 'x',
      }],
    });
    const result = (await triageMessages([message()], {
      completer: completer([invalid, invalid]),
      timezone: 'UTC',
      now: new Date(),
    }))[0];
    expect(result.ok).toBe(false);
  });

  it.each([
    {
      name: 'missing',
      results: [{
        index: 0,
        classification: 'junk',
        summary: 's',
        importance: 'low',
        events: [],
        rationale: 'r',
      }],
    },
    {
      name: 'duplicate',
      results: [0, 0].map((index) => ({
        index,
        classification: 'junk',
        summary: 's',
        importance: 'low',
        events: [],
        rationale: 'r',
      })),
    },
    {
      name: 'out-of-range',
      results: [0, 2].map((index) => ({
        index,
        classification: 'junk',
        summary: 's',
        importance: 'low',
        events: [],
        rationale: 'r',
      })),
    },
  ])('rejects $name result indexes for a two-message batch', async ({
    results,
  }) => {
    const invalid = JSON.stringify({ results });
    const outcomes = await triageMessages(
      [message(), message()],
      {
        completer: completer([invalid, invalid]),
        timezone: 'UTC',
        now: new Date(),
      },
    );
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((outcome) => !outcome.ok)).toBe(true);
  });

  it('keeps due_at null for ambiguous dates', async () => {
    const result = (await triageMessages([message()], {
      completer: completer([ambiguousDateResultJson]),
      timezone: 'UTC',
      now: new Date(),
    }))[0];
    expect(result.ok && result.result.events[0].due_at).toBeNull();
  });

  it('truncates bodies and includes timezone and current date', async () => {
    const recording = completer([junkResultJson]);
    await triageMessages([message({ bodyText: 'x'.repeat(9000) })], {
      completer: recording,
      timezone: 'America/New_York',
      now: new Date('2026-07-17T12:00:00Z'),
    });
    expect(recording.calls[0].system).toContain('America/New_York');
    expect(recording.calls[0].system).toContain('2026-07-17');
    expect(recording.calls[0].user).toContain('x'.repeat(4000));
    expect(recording.calls[0].user).not.toContain('x'.repeat(4001));
  });

  it('uses the student local date near a UTC day boundary', () => {
    const { system } = buildTriagePrompt(
      [message()],
      'America/New_York',
      new Date('2026-07-18T01:00:00Z'),
    );
    expect(system).toContain('Today is 2026-07-17');
  });

  it('chunks more than 10 messages into multiple calls', async () => {
    const ten = JSON.stringify({
      results: Array.from({ length: 10 }, (_, index) => ({
        index,
        classification: 'junk',
        summary: 's',
        importance: 'low',
        events: [],
        rationale: 'r',
      })),
    });
    const two = JSON.stringify({
      results: Array.from({ length: 2 }, (_, index) => ({
        index,
        classification: 'junk',
        summary: 's',
        importance: 'low',
        events: [],
        rationale: 'r',
      })),
    });
    const recording = completer([ten, two]);
    const results = await triageMessages(
      Array.from({ length: 12 }, () => message()),
      { completer: recording, timezone: 'UTC', now: new Date() },
    );
    expect(recording.calls).toHaveLength(2);
    expect(results).toHaveLength(12);
    expect(results.every((result) => result.ok)).toBe(true);
  });
});

describe('buildTriagePrompt', () => {
  it('embeds from, subject, date, and body for each message', () => {
    const { user } = buildTriagePrompt(
      [message({ from: 'a@b.edu', subject: 'Hi there' })],
      'UTC',
      new Date(),
    );
    expect(user).toContain('a@b.edu');
    expect(user).toContain('Hi there');
    expect(user).toContain('2026-07-14T13:30:00.000Z');
    expect(user).toContain('Body text here.');
  });
});

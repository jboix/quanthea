import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { compactHistory, compactSteps, toolSummary } from './compact.ts';
import type { ThreadMessage } from './run-context.ts';

describe('toolSummary', () => {
  test('says what each tool call did in one line', () => {
    expect(
      toolSummary('describe', { connector: 'events' }, { ok: true, entities: [{}], more: 0 }),
    ).toBe('describe(events): 1 entity');
    expect(
      toolSummary(
        'sample_values',
        { entity: 'events', field: 'service' },
        { ok: false, error: 'events.service is hidden.' },
      ),
    ).toBe('sample_values(events.service): failed: events.service is hidden.');
    expect(toolSummary('write_dashboard', { spec: {} }, { ok: true, version: 2, panels: [] })).toBe(
      'write_dashboard: saved version 2',
    );
    expect(
      toolSummary('ask_person', { question: 'Which errors?', options: ['5xx', 'orders'] }, {}),
    ).toBe('ask_person: "Which errors?" options ["5xx","orders"]');
    expect(toolSummary('unknown', {}, {})).toBe('unknown: done');
  });
});

/**
 * A stored message.
 *
 * @param id - Its id.
 * @param role - Its role.
 * @param parts - Its parts.
 * @returns The message.
 */
function message(id: string, role: 'user' | 'assistant', parts: unknown[]): ThreadMessage {
  return { id, role, parts } as ThreadMessage;
}

describe('compactHistory', () => {
  const earlier = message('a1', 'assistant', [
    { type: 'step-start' },
    { type: 'reasoning', text: 'thinking' },
    {
      type: 'tool-describe',
      toolCallId: 'c1',
      state: 'output-available',
      input: { connector: 'events' },
      output: { ok: true, entities: [{}, {}], more: 0 },
    },
    { type: 'data-plan', data: {} },
    { type: 'text', text: 'Here is a plan.' },
  ]);
  const latest = message('a2', 'assistant', [
    { type: 'tool-describe', toolCallId: 'c2', state: 'output-available', input: {}, output: {} },
  ]);

  test('turns earlier tool calls into notes and keeps their text', () => {
    const compacted = compactHistory([
      message('u1', 'user', []),
      earlier,
      message('u2', 'user', []),
    ]);
    expect(compacted[1]?.parts).toEqual([
      { type: 'text', text: '[earlier tool call] describe(events): 2 entities' },
      { type: 'text', text: 'Here is a plan.' },
    ] as ThreadMessage['parts']);
  });

  test('keeps the latest turn whole', () => {
    const conversation = [message('u1', 'user', []), latest];
    expect(compactHistory(conversation)).toEqual(conversation);
  });
});

describe('compactSteps', () => {
  const big = { ok: false, error: 'bad', panels: [{ panelId: 'p', queries: 'x'.repeat(500) }] };
  const steps: ModelMessage[] = [
    { role: 'user', content: 'Build it' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'write_dashboard', input: {} }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'write_dashboard',
          output: { type: 'json', value: big },
        },
      ],
    },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'c2', toolName: 'write_dashboard', input: {} }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c2',
          toolName: 'write_dashboard',
          output: { type: 'json', value: big },
        },
      ],
    },
  ];

  test('elides older drafts and summarizes older large results', () => {
    const compacted = compactSteps(steps);
    expect(compacted[1]).toMatchObject({
      content: [{ input: { elided: 'an earlier draft; the latest one is below' } }],
    });
    expect(compacted[2]).toMatchObject({
      content: [{ output: { type: 'text', value: 'write_dashboard: failed: bad' } }],
    });
  });

  test('keeps the latest call and its results whole', () => {
    const compacted = compactSteps(steps);
    expect(compacted.slice(3)).toEqual(steps.slice(3));
    expect(compacted[0]).toEqual(steps[0] as ModelMessage);
  });
});

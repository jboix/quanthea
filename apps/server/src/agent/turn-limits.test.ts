import { describe, expect, test } from 'bun:test';
import type { LanguageModelUsage } from 'ai';
import type { RunContext } from './run-context.ts';
import { countLimits } from './turn-limits.ts';

/**
 * The parts of a run the limits read, with the limits given.
 *
 * @param limits - The limits.
 * @param limits.tokensPerTurn - The token limit, `null` for none.
 * @param limits.toolCallsPerTurn - The tool call limit, `null` for none.
 * @returns The run.
 */
function runWith(limits: { tokensPerTurn: number | null; toolCallsPerTurn: number | null }) {
  const counters = {
    planPending: false,
    asked: false,
    explaining: false,
    toolCalls: 0,
    tokens: 0,
    paused: undefined,
  };
  return { settings: { limits }, counters } as unknown as RunContext;
}

/**
 * A step that spent some tokens and made some calls.
 *
 * @param tokens - Its tokens.
 * @param calls - How many tool calls it made.
 * @returns The step.
 */
function step(tokens: number, calls: number) {
  const usage = { totalTokens: tokens } as LanguageModelUsage;
  return { usage, toolCalls: Array.from({ length: calls }, () => ({})) };
}

describe('the limits of a turn', () => {
  test('pause once the tokens reach the limit', () => {
    const run = runWith({ tokensPerTurn: 50_000, toolCallsPerTurn: null });
    countLimits(run, step(30_000, 1));
    expect(run.counters.paused).toBeUndefined();
    countLimits(run, step(30_000, 1));
    expect(run.counters.paused).toEqual({ kind: 'tokens', limit: 50_000, used: 60_000 });
  });

  test('name the tool calls first when both are reached', () => {
    const run = runWith({ tokensPerTurn: 10_000, toolCallsPerTurn: 2 });
    countLimits(run, step(20_000, 2));
    expect(run.counters.paused?.kind).toBe('calls');
  });

  test('never pause without limits, or a turn that ends anyway', () => {
    const unlimited = runWith({ tokensPerTurn: null, toolCallsPerTurn: null });
    countLimits(unlimited, step(10_000_000, 500));
    expect(unlimited.counters.paused).toBeUndefined();
    const planned = runWith({ tokensPerTurn: null, toolCallsPerTurn: 1 });
    planned.counters.planPending = true;
    countLimits(planned, step(100, 1));
    expect(planned.counters.paused).toBeUndefined();
  });
});

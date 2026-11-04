import { describe, expect, test } from 'bun:test';
import type { ThreadMessage } from './run-context.ts';
import { startingWorked } from './usage.ts';

/**
 * A conversation that ends with an answer that worked some time.
 *
 * @param workedMs - What the answer's metadata says it worked.
 * @returns The messages.
 */
function endingWith(workedMs: unknown): ThreadMessage[] {
  const question = { id: 'q', role: 'user', parts: [] } as ThreadMessage;
  const answer = { id: 'a', role: 'assistant', parts: [], metadata: { workedMs } };
  return [question, answer as ThreadMessage];
}

describe('the working time a run starts from', () => {
  test('is the continued answer’s, and nothing for a new answer', () => {
    expect(startingWorked(endingWith(90_000), true)).toBe(90_000);
    expect(startingWorked(endingWith(90_000), false)).toBe(0);
  });

  test('is nothing when the answer says nothing usable', () => {
    expect(startingWorked(endingWith(undefined), true)).toBe(0);
    expect(startingWorked(endingWith('90s'), true)).toBe(0);
    expect(startingWorked(endingWith(-5), true)).toBe(0);
  });
});

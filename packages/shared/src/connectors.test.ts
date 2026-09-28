import { describe, expect, test } from 'bun:test';
import { guardrailsSchema } from './connectors.ts';

/**
 * The messages of the issues a guardrails value raises.
 *
 * @param value - The guardrails to check.
 * @returns The messages, in order.
 */
function messagesOf(value: unknown): string[] {
  const parsed = guardrailsSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe('guardrailsSchema', () => {
  test('fills the defaults', () => {
    expect(guardrailsSchema.parse({})).toEqual({
      timeoutMs: 10_000,
      maxRows: 50_000,
      maxRangeDays: 90,
    });
  });

  test('says each limit in the unit the screen shows', () => {
    expect(messagesOf({ timeoutMs: 500, maxRows: 0, maxRangeDays: 4000 })).toEqual([
      'At least 1 second.',
      'At least 1 row.',
      'At most 3650 days.',
    ]);
    expect(messagesOf({ timeoutMs: null, maxRows: 1.5 })).toEqual([
      'Use a number.',
      'Use a whole number.',
    ]);
  });
});

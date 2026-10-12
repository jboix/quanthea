import { describe, expect, test } from 'bun:test';
import {
  guardrailsSchema,
  listShowsObject,
  matchesObjectName,
  objectVisibilitySchema,
} from './connectors.ts';

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

describe('matchesObjectName', () => {
  test('compares a plain name whole and without case', () => {
    expect(matchesObjectName('Orders', 'orders')).toBe(true);
    expect(matchesObjectName('orders', 'orders_archive')).toBe(false);
  });

  test('lets a star stand for any run of characters, dots included', () => {
    expect(matchesObjectName('logs-*', 'logs-2026.10.12')).toBe(true);
    expect(matchesObjectName('logs-*', 'logs')).toBe(false);
    expect(matchesObjectName('*', 'anything')).toBe(true);
    expect(matchesObjectName('analytics.*', 'analytics.events')).toBe(true);
    expect(matchesObjectName('*-audit-*', 'security-audit-2026')).toBe(true);
    expect(matchesObjectName('a*b*c', 'a-b')).toBe(false);
    expect(matchesObjectName('ab*ba', 'aba')).toBe(false);
  });
});

describe('listShowsObject', () => {
  test('an except list hides its names and shows the rest', () => {
    const visibility = { mode: 'except', names: ['logs-secret-*'] } as const;
    expect(listShowsObject(visibility, 'logs-secret-1')).toBe(false);
    expect(listShowsObject(visibility, 'logs-app-1')).toBe(true);
  });

  test('an only list shows its names and hides the rest', () => {
    const visibility = { mode: 'only', names: ['orders', 'logs-*'] } as const;
    expect(listShowsObject(visibility, 'orders')).toBe(true);
    expect(listShowsObject(visibility, 'customers')).toBe(false);
  });

  test('an empty except list shows everything', () => {
    expect(listShowsObject(objectVisibilitySchema.parse({}), 'orders')).toBe(true);
  });
});

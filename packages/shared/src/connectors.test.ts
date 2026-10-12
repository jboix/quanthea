import { describe, expect, test } from 'bun:test';
import {
  coveringEntry,
  guardrailsSchema,
  listShowsObject,
  matchesObjectName,
  type ObjectVisibility,
  objectVisibilitySchema,
  wholeObjectVisibilitySchema,
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

describe('a list read as the source names its objects', () => {
  const exact = { exactCase: true, qualified: false };
  const sql = { exactCase: false, qualified: true, defaultSchema: 'public' };

  test('compares with case where the source tells names apart by it', () => {
    expect(matchesObjectName('Orders', 'orders', true)).toBe(false);
    expect(matchesObjectName('Ord*', 'Orders', true)).toBe(true);
    expect(listShowsObject({ mode: 'only', names: ['orders'] }, 'Orders', exact)).toBe(false);
    expect(listShowsObject({ mode: 'only', names: ['orders'] }, 'Orders')).toBe(true);
    expect(listShowsObject({ mode: 'except', names: ['orders'] }, 'Orders', exact)).toBe(true);
  });

  test('a hidden name covers a qualified name by any of its endings', () => {
    const hidden = { mode: 'except', names: ['salaries', 'shop.*'] } as const;
    expect(coveringEntry(hidden, 'hr.salaries', sql)).toBe('salaries');
    expect(coveringEntry(hidden, 'shop.orders', sql)).toBe('shop.*');
    expect(coveringEntry(hidden, 'hr.people', sql)).toBeUndefined();
    expect(listShowsObject(hidden, 'hr.salaries', sql)).toBe(false);
    expect(listShowsObject(hidden, 'hr.salaries')).toBe(true);
  });

  test('an only list covers a qualified name as written, or without the default schema', () => {
    const only = { mode: 'only', names: ['orders'] } as const;
    expect(listShowsObject(only, 'orders', sql)).toBe(true);
    expect(listShowsObject(only, 'public.orders', sql)).toBe(true);
    expect(listShowsObject(only, 'shop.orders', sql)).toBe(false);
    expect(listShowsObject(only, 'public.orders', { ...sql, defaultSchema: undefined })).toBe(
      false,
    );
  });
});

describe('a visibility', () => {
  /**
   * The messages of the issues a whole visibility raises.
   *
   * @param value - The value.
   * @returns The messages.
   */
  function issuesOf(value: unknown): string[] {
    const parsed = wholeObjectVisibilitySchema.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
  }

  test('that replaces a stored one names every key: a partial one is refused, not filled', () => {
    const whole: ObjectVisibility = { showSystem: true, mode: 'only', names: ['orders'] };
    expect(wholeObjectVisibilitySchema.parse(whole)).toEqual(whole);
    expect(issuesOf({ showSystem: true })).toEqual([
      'A visibility is replaced whole: give showSystem, mode and names, as the connector holds them.',
      'A visibility is replaced whole: give showSystem, mode and names, as the connector holds them.',
    ]);
    expect(issuesOf({ ...whole, mode: 'all' })[0]).not.toContain('replaced whole');
  });

  test('refuses a key it does not know, so a misspelt list is not read as empty', () => {
    expect(issuesOf({ showSystem: false, mode: 'only', names: [], name: ['orders'] })[0]).toContain(
      '"name"',
    );
    const filled = objectVisibilitySchema.safeParse({ mode: 'only', name: ['orders'] });
    expect(filled.error?.issues[0]?.message).toContain('"name"');
  });
});

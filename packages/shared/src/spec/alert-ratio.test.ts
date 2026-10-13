import { describe, expect, test } from 'bun:test';
import { alertSpecSchema } from './alert.ts';
import { alertConnectors } from './alert-ratio.ts';

const requests = { refId: 'B', connector: 'warehouse', language: 'sql', sql: 'SELECT 1' };

/**
 * A spec as JSON: errors above 5 for 5 minutes.
 *
 * @param overrides - Fields to replace.
 * @returns The spec.
 */
function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    specVersion: 1,
    title: 'Error share',
    query: { refId: 'A', connector: 'logs', language: 'sql', sql: 'SELECT 2' },
    condition: { kind: 'threshold', op: 'above', value: 0.05, for: '5m' },
    every: '1m',
    lookback: '10m',
    severity: 'warning',
    message: { title: '{alert}', body: '{numerator} of {denominator}' },
    ...overrides,
  };
}

/**
 * The messages of the issues a spec fails with, by path.
 *
 * @param spec - The spec, as JSON.
 * @returns Each path with its message; none for a valid spec.
 */
function issues(spec: unknown): Record<string, string> {
  const parsed = alertSpecSchema.safeParse(spec);
  if (parsed.success) return {};
  return Object.fromEntries(
    parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
  );
}

describe('the second query of a ratio', () => {
  test('is optional: a spec without one parses as before, with no field added', () => {
    const parsed = alertSpecSchema.parse(input());
    expect(parsed).not.toHaveProperty('dividedBy');
    expect(alertConnectors(parsed)).toEqual(['logs']);
  });

  test('reads a division by 0 as the number 0 unless it says no value', () => {
    const parsed = alertSpecSchema.parse(input({ dividedBy: { query: requests } }));
    expect<unknown>(parsed.dividedBy).toEqual({ query: requests, whenZero: 'zero' });
    const silent = input({ dividedBy: { query: requests, whenZero: 'no_value', field: 'total' } });
    expect(alertSpecSchema.parse(silent).dividedBy?.whenZero).toBe('no_value');
    const unknown = issues(input({ dividedBy: { query: requests, whenZero: 'infinity' } }));
    expect(Object.keys(unknown)).toEqual(['dividedBy.whenZero']);
  });

  test('names both connectors once each', () => {
    const two = alertSpecSchema.parse(input({ dividedBy: { query: requests } }));
    expect(alertConnectors(two)).toEqual(['logs', 'warehouse']);
    const same = { ...requests, connector: 'logs' };
    expect(alertConnectors(alertSpecSchema.parse(input({ dividedBy: { query: same } })))).toEqual([
      'logs',
    ]);
  });

  test('is compared by a threshold, a change, and tests joined', () => {
    const dividedBy = { query: requests };
    const change = {
      kind: 'change',
      direction: 'up',
      amount: 50,
      unit: 'percent',
      within: '5m',
      for: '0m',
    };
    const joined = {
      kind: 'all',
      of: [
        { kind: 'threshold', op: 'above', value: 0.05 },
        { kind: 'threshold', op: 'above', value: 100, field: 'requests' },
      ],
      for: '5m',
    };
    for (const condition of [change, joined])
      expect(issues(input({ dividedBy, condition }))).toEqual({});
  });

  test('is refused under a past or a band that reads the ratio, and under no_data', () => {
    const dividedBy = { query: requests };
    const past = { kind: 'past', direction: 'up', amount: 30, unit: 'percent', ago: '7d' };
    const band = { kind: 'band', side: 'either', deviations: 3, baseline: '1d' };
    expect(issues(input({ dividedBy, condition: { ...past, for: '0m' } }))).toEqual({
      'condition.kind': expect.stringContaining('compared by a threshold or a change'),
    });
    const banded = issues(input({ dividedBy, condition: { ...band, for: '0m' } }));
    expect(Object.keys(banded)).toEqual(['condition.kind']);
    expect(issues(input({ dividedBy, condition: { kind: 'no_data', for: '5m' } }))).toEqual({
      dividedBy: expect.stringContaining('watches one query'),
    });
    expect(issues(input({ condition: { ...past, for: '0m' } }))).toEqual({});
  });

  test('leaves a past on a column of the first query alone: that part is not divided', () => {
    const above = { kind: 'threshold', op: 'above', value: 0.05 };
    const past = { kind: 'past', direction: 'up', amount: 30, unit: 'percent', ago: '1d' };
    const own = { kind: 'all', of: [above, { ...past, field: 'requests' }], for: '0m' };
    const ratio = { kind: 'all', of: [above, past], for: '0m' };
    const dividedBy = { query: requests };
    expect(issues(input({ dividedBy, condition: own }))).toEqual({});
    expect(Object.keys(issues(input({ dividedBy, condition: ratio })))).toEqual([
      'condition.of.1.kind',
    ]);
  });
});

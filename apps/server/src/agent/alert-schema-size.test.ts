import { describe, expect, test } from 'bun:test';
import { alertConditionSchema } from '@quanthea/shared';
import { z } from 'zod';
import { alertEditSchema } from './alert-edit.ts';

/**
 * The most characters the alert edit tool's JSON schema may have. Providers that constrain tool
 * input refuse a schema that grows too large, and 18,000 is the largest ceiling the dashboard edit
 * tool has, so no larger schema is known to pass. The schema measured 8,156 characters with a
 * threshold and no data as the only conditions, and measures 17,237 with a change, a comparison
 * with the past, a band, joined tests and the second query of a ratio. Raise the ceiling only with
 * a number the maintainer has checked against the providers.
 */
const ceiling = 18_000;

/** The alert edit tool's JSON schema as JSON text, measured as the dashboard edit tool's is. */
const json = JSON.stringify(
  z.toJSONSchema(alertEditSchema, { io: 'input', unrepresentable: 'any' }),
);

/** A threshold on another column, as a part of a joined condition. */
const requests = { kind: 'threshold', op: 'above', value: 100, field: 'requests' };

/** One condition of every kind, and joined tests with every kind of part and of format. */
const conditions: readonly Record<string, unknown>[] = [
  { kind: 'threshold', op: 'above', value: 0.02, for: '5m' },
  { kind: 'change', direction: 'down', amount: 50, unit: 'percent', within: '10m', for: '0m' },
  { kind: 'past', direction: 'up', amount: 30, unit: 'percent', ago: '7d', for: '10m' },
  { kind: 'band', side: 'either', deviations: 3, baseline: '1d', for: '5m' },
  { kind: 'no_data', for: '10m' },
  {
    kind: 'all',
    of: [
      { kind: 'band', side: 'above', deviations: 3, baseline: '1d' },
      { ...requests, reduce: 'sum', format: { $fmt: 'number', decimals: 0, compact: true } },
      { ...requests, field: 'bytes', format: { $fmt: 'bytes', base: 1024 } },
      { ...requests, field: 'share', format: { $fmt: 'percent', input: 'ratio' } },
    ],
    for: '5m',
  },
  {
    kind: 'any',
    of: [
      { kind: 'past', direction: 'down', amount: 5, unit: 'absolute', ago: '1d' },
      { ...requests, field: 'latency', format: { $fmt: 'duration', unit: 'ms' } },
      { ...requests, field: 'revenue', format: { $fmt: 'currency', code: 'EUR' } },
      {
        kind: 'change',
        direction: 'up',
        amount: 5,
        unit: 'absolute',
        within: '2m',
        field: 'load',
        format: { $fmt: 'si', unit: 'W' },
      },
    ],
    for: '0m',
  },
];

/**
 * An edit that only sets the condition.
 *
 * @param condition - The condition.
 * @returns The edit.
 */
function edit(condition: unknown): Record<string, unknown> {
  return { note: 'the condition', condition };
}

describe('the size of the alert edit schema', () => {
  test('has no reference and stays under its ceiling', () => {
    const message = `The alert edit schema is ${json.length} characters, over its ceiling of ${ceiling}.`;
    expect(json).not.toContain('$ref');
    expect(json.length <= ceiling, message).toBe(true);
  });

  test('names every kind of condition', () => {
    for (const kind of ['threshold', 'change', 'past', 'band', 'all', 'any', 'no_data'])
      expect(json).toContain(`"${kind}"`);
    expect(json).toContain('"dividedBy"');
  });

  test('takes every condition the spec takes', () => {
    for (const condition of conditions) {
      expect(alertConditionSchema.safeParse(condition).success).toBe(true);
      expect(alertEditSchema.safeParse(edit(condition)).success).toBe(true);
    }
  });

  test('leaves the fields of a part format to the check of the spec', () => {
    const format = { $fmt: 'currency', unit: 'ms' };
    const condition = {
      kind: 'all',
      of: [
        { kind: 'threshold', op: 'above', value: 1 },
        { ...requests, format },
      ],
      for: '5m',
    };
    expect(alertEditSchema.safeParse(edit(condition)).success).toBe(true);
    const checked = alertConditionSchema.safeParse(condition);
    expect(checked.success).toBe(false);
    expect(checked.error?.issues[0]?.path.slice(0, 3)).toEqual(['of', 1, 'format']);
  });

  test('still refuses a part of an unknown kind and a field no part has', () => {
    const nested = { kind: 'all', of: [requests, { kind: 'no_data' }], for: '5m' };
    const unknown = { kind: 'any', of: [requests, { ...requests, window: '5m' }], for: '5m' };
    expect(alertEditSchema.safeParse(edit(nested)).success).toBe(false);
    expect(alertEditSchema.safeParse(edit(unknown)).success).toBe(false);
  });
});

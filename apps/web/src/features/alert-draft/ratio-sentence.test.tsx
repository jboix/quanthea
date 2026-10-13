import { describe, expect, test } from 'bun:test';
import { type AlertSpec, alertSpecSchema } from '@quanthea/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { withDivisorField, withWhenZero } from './condition.ts';
import type { FixedPart } from './condition-editors.tsx';
import { ConditionSentence } from './condition-sentence.tsx';
import { withPartField } from './condition-tests.ts';
import { conditionLines, lineName } from './replay-model.ts';

const requests = { refId: 'B', connector: 'warehouse', language: 'sql', sql: 'SELECT 2' };

/**
 * A spec on a ratio: the errors of each service over its requests.
 *
 * @param overrides - Fields to replace.
 * @returns The spec.
 */
function ratioSpec(overrides: Record<string, unknown> = {}): AlertSpec {
  return alertSpecSchema.parse({
    specVersion: 1,
    title: 'Error share above 5%',
    query: { refId: 'A', connector: 'logs', language: 'sql', sql: 'SELECT 1' },
    dividedBy: { query: requests, field: 'requests' },
    value: { field: 'errors', format: { $fmt: 'percent', decimals: 0 }, by: ['service'] },
    condition: { kind: 'threshold', op: 'above', value: 0.05, for: '5m' },
    every: '1m',
    lookback: '30m',
    severity: 'critical',
    message: { title: '{alert}', body: '{numerator} of {denominator}' },
    ...overrides,
  });
}

/**
 * The sentence as plain text.
 *
 * @param spec - The spec.
 * @param fixed - The parts shown as words.
 * @returns The words, tags taken off.
 */
function sentence(spec: AlertSpec, fixed?: readonly FixedPart[]): string {
  const html = renderToStaticMarkup(
    <ConditionSentence
      spec={spec}
      threshold={null}
      disabled={false}
      onChange={() => undefined}
      fixed={fixed}
    />,
  );
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

/**
 * The names of the editors the sentence offers.
 *
 * @param spec - The spec.
 * @param fixed - The parts shown as words.
 * @returns The label of each editor's button, in order.
 */
function editors(spec: AlertSpec, fixed?: readonly FixedPart[]): string[] {
  const html = renderToStaticMarkup(
    <ConditionSentence
      spec={spec}
      threshold={null}
      disabled={false}
      onChange={() => undefined}
      fixed={fixed}
    />,
  );
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1] ?? '');
}

describe('the sentence of a ratio', () => {
  test('reads as one sentence: what is divided, by what, and what a division by 0 gives', () => {
    expect(sentence(ratioSpec())).toBe(
      'Fires when the errors of each service, divided by the requests of the second query (0 when that is 0), is above 5% for 5 minutes, checked every minute.',
    );
    const silent = ratioSpec({ dividedBy: { query: requests, whenZero: 'no_value' } });
    expect(sentence(silent)).toBe(
      'Fires when the errors of each service, divided by the value of the second query (no value when that is 0), is above 5% for 5 minutes, checked every minute.',
    );
  });

  test('reads a change and joined tests on the ratio', () => {
    const rose = {
      kind: 'change',
      direction: 'up',
      amount: 50,
      unit: 'percent',
      within: '10m',
      for: '0m',
    };
    expect(sentence(ratioSpec({ condition: rose }))).toBe(
      'Fires when the errors of each service, divided by the requests of the second query (0 when that is 0), rises by at least 50% within 10 minutes at once, checked every minute.',
    );
    const busy = {
      kind: 'all',
      of: [
        { kind: 'threshold', op: 'above', value: 0.05 },
        { kind: 'threshold', op: 'above', value: 100, field: 'errors', format: { $fmt: 'number' } },
      ],
      for: '5m',
    };
    expect(sentence(ratioSpec({ condition: busy }))).toBe(
      'Fires when, for each service, the errors, divided by the requests of the second query (0 when that is 0), is above 5% and errors is above 100, for 5 minutes, checked every minute.',
    );
  });

  test('has an editor for the column divided by and for the division by 0', () => {
    expect(editors(ratioSpec())).toEqual([
      'the errors',
      'each service',
      'the requests',
      '0 when that is 0',
      'above 5%',
      '5 minutes',
      'every minute',
    ]);
    expect(editors(ratioSpec(), ['watch', 'by', 'within'])).toEqual([
      'above 5%',
      '5 minutes',
      'every minute',
    ]);
    expect(sentence(ratioSpec(), ['watch', 'by', 'within'])).toBe(sentence(ratioSpec()));
  });

  test('leaves a sentence without a second query as it was', () => {
    const plain = ratioSpec({ dividedBy: undefined });
    expect(sentence(plain)).toBe(
      'Fires when the error share of each service is above 5% for 5 minutes, checked every minute.',
    );
  });

  test('changes the column divided by and the reading of a division by 0', () => {
    const spec = ratioSpec();
    expect(withDivisorField(spec, ' total ').dividedBy).toMatchObject({ field: 'total' });
    expect<unknown>(withDivisorField(spec, '').dividedBy).toEqual({
      query: requests,
      whenZero: 'zero',
    });
    expect(withWhenZero(spec, 'no_value').dividedBy).toMatchObject({
      field: 'requests',
      whenZero: 'no_value',
    });
    const plain = ratioSpec({ dividedBy: undefined });
    expect(withWhenZero(plain, 'no_value')).toBe(plain);
    expect(alertSpecSchema.safeParse(withWhenZero(spec, 'no_value')).success).toBe(true);
  });

  test('keeps the column of a part that compares with history, with why', () => {
    const above = { kind: 'threshold', op: 'above', value: 0.05 };
    const past = { kind: 'past', direction: 'up', amount: 30, unit: 'percent', ago: '7d' };
    const of = [above, { ...past, field: 'orders' }, { ...above, field: 'requests' }];
    const spec = ratioSpec({ condition: { kind: 'all', of, for: '5m' } });
    expect(withPartField(spec, 1, ' ')).toContain('cannot read a ratio');
    expect(withPartField(spec, 1, ' sales ')).toMatchObject({
      condition: { of: [above, { field: 'sales' }, { field: 'requests' }] },
    });
    const emptied = withPartField(spec, 2, '');
    expect(alertSpecSchema.safeParse(emptied).success).toBe(true);
    const plain = { ...spec, dividedBy: undefined };
    expect(alertSpecSchema.safeParse(withPartField(plain, 1, '')).success).toBe(true);
  });

  test('draws the ratio against its threshold', () => {
    expect(lineName(ratioSpec().condition)).toBe('threshold');
    expect(conditionLines(ratioSpec().condition, undefined)).toEqual({ threshold: 0.05 });
  });
});

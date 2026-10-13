import { describe, expect, test } from 'bun:test';
import { type AlertSpec, alertSpecSchema } from '@quanthea/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FixedPart } from './condition-editors.tsx';
import { ConditionSentence } from './condition-sentence.tsx';
import { changeTestWords, withJoiner, withTest, withWithin } from './condition-tests.ts';
import { conditionLines, lineName } from './replay-model.ts';

/**
 * A spec with a condition.
 *
 * @param condition - The condition.
 * @param overrides - Other fields to replace.
 * @returns The spec.
 */
function specWith(condition: unknown, overrides: Record<string, unknown> = {}): AlertSpec {
  return alertSpecSchema.parse({
    specVersion: 1,
    title: 'Error share per service',
    query: { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT 1' },
    value: { field: 'share', format: { $fmt: 'percent', decimals: 1 }, by: ['service'] },
    condition,
    every: '1m',
    lookback: '30m',
    severity: 'critical',
    message: { title: '{alert}', body: '{value}' },
    ...overrides,
  });
}

const dropped = {
  kind: 'change',
  direction: 'down',
  amount: 50,
  unit: 'percent',
  within: '10m',
  for: '0m',
};

const busy = {
  kind: 'all',
  of: [
    { kind: 'threshold', op: 'above', value: 0.02 },
    { kind: 'threshold', op: 'above', value: 100, field: 'requests', format: { $fmt: 'number' } },
    {
      kind: 'change',
      direction: 'up',
      amount: 200,
      unit: 'absolute',
      within: '5m',
      field: 'p99_ms',
      format: { $fmt: 'number' },
    },
  ],
  for: '5m',
};

const lastWeek = {
  kind: 'past',
  direction: 'up',
  amount: 30,
  unit: 'percent',
  ago: '7d',
  for: '10m',
};

const unusual = { kind: 'band', side: 'either', deviations: 3, baseline: '1d', for: '5m' };

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
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

describe('the condition sentence', () => {
  test('reads a threshold, and says at once without a wait', () => {
    const above = { kind: 'threshold', op: 'above', value: 0.02, for: '5m' };
    expect(sentence(specWith(above))).toBe(
      'Fires when the error share of each service is above 2% for 5 minutes, checked every minute.',
    );
    expect(sentence(specWith({ ...above, for: '0m' }))).toBe(
      'Fires when the error share of each service is above 2% at once, checked every minute.',
    );
  });

  test('reads a change as one sentence', () => {
    expect(sentence(specWith(dropped))).toBe(
      'Fires when the error share of each service drops by at least 50% within 10 minutes at once, checked every minute.',
    );
    const rose = { ...dropped, direction: 'up', amount: 0.05, unit: 'absolute', for: '2m' };
    expect(sentence(specWith(rose))).toBe(
      'Fires when the error share of each service rises by at least 5% within 10 minutes for 2 minutes, checked every minute.',
    );
  });

  test('reads a comparison with the past as one sentence', () => {
    expect(sentence(specWith(lastWeek))).toBe(
      'Fires when the error share of each service is at least 30% above its value a week earlier for 10 minutes, checked every minute.',
    );
    const fewer = { ...lastWeek, direction: 'down', amount: 0.01, unit: 'absolute', ago: '1h' };
    expect(sentence(specWith(fewer), ['within'])).toBe(
      'Fires when the error share of each service is at least 1% below its value an hour earlier for 10 minutes, checked every minute.',
    );
  });

  test('reads a band as one sentence', () => {
    expect(sentence(specWith(unusual))).toBe(
      'Fires when the error share of each service is more than 3 deviations from its mean of the last day for 5 minutes, checked every minute.',
    );
    const high = { ...unusual, side: 'above', deviations: 2.5, baseline: '6h' };
    expect(sentence(specWith(high), ['within'])).toBe(
      'Fires when the error share of each service is more than 2.5 deviations above its mean of the last 6 hours for 5 minutes, checked every minute.',
    );
  });

  test('reads a test with history joined with another', () => {
    const { for: _for, ...band } = unusual;
    const joined = { kind: 'all', of: [{ kind: 'threshold', op: 'above', value: 0.02 }, band] };
    expect(sentence(specWith({ ...joined, for: '5m' }))).toBe(
      'Fires when, for each service, the error share is above 2% and it is more than 3 deviations from its mean of the last day, for 5 minutes, checked every minute.',
    );
  });

  test('changes the values of a test with history', () => {
    const wider = withTest(specWith(unusual), 0, { deviations: 4, side: 'above' });
    expect(wider.condition).toMatchObject({ kind: 'band', deviations: 4, side: 'above' });
    const daily = withTest(specWith(lastWeek), 0, { ago: '1d' });
    expect(daily.condition).toMatchObject({ kind: 'past', ago: '1d', amount: 30 });
    expect(alertSpecSchema.safeParse(daily).success).toBe(true);
  });

  test('reads joined tests one after the other, each with what it reads', () => {
    expect(sentence(specWith(busy))).toBe(
      'Fires when, for each service, the error share is above 2% and requests is above 100 and p99 ms rises by at least 200 within 5 minutes, for 5 minutes, checked every minute.',
    );
    expect(sentence(specWith({ ...busy, kind: 'any' }), ['watch', 'by', 'within'])).toContain(
      'the error share is above 2% or requests is above 100 or p99 ms rises',
    );
  });

  test('reads a condition on the absence of data', () => {
    expect(sentence(specWith({ kind: 'no_data', for: '10m' }))).toBe(
      'Fires when the query returns no value for 10 minutes, checked every minute.',
    );
  });

  test('shows as buttons what can change, and as words what is fixed', () => {
    const count = (fixed?: readonly FixedPart[]) =>
      renderToStaticMarkup(
        <ConditionSentence
          spec={specWith(dropped)}
          threshold={null}
          disabled={false}
          onChange={() => undefined}
          fixed={fixed}
        />,
      ).split('<button').length - 1;
    // What it watches, the series, the change, its span, the wait and the interval.
    expect(count()).toBe(6);
    expect(count(['watch', 'by', 'within'])).toBe(3);
  });
});

describe('changing the tests of a condition by hand', () => {
  test('changes one test and keeps the spec valid', () => {
    const more = withTest(specWith(dropped), 0, { amount: 30, direction: 'up' });
    expect(alertSpecSchema.safeParse(more).success).toBe(true);
    expect(more.condition).toMatchObject({ amount: 30, direction: 'up', within: '10m', for: '0m' });
    const part = withTest(specWith(busy), 1, { value: 500, field: undefined });
    expect(alertSpecSchema.safeParse(part).success).toBe(true);
    expect(part.condition).toMatchObject({
      of: [{ value: 0.02 }, { kind: 'threshold', op: 'above', value: 500 }, { field: 'p99_ms' }],
    });
    expect(JSON.stringify(part.condition)).not.toContain('requests');
    expect(withTest(specWith(dropped), 3, { amount: 1 })).toEqual(specWith(dropped));
  });

  test('keeps the window longer than the span of a change', () => {
    expect(withWithin(specWith(dropped), 0, '20m')).toMatchObject({ lookback: '30m' });
    const longer = withWithin(specWith(dropped), 0, '45m');
    expect(longer).toMatchObject({ lookback: '90m', condition: { within: '45m' } });
    expect(alertSpecSchema.safeParse(longer).success).toBe(true);
  });

  test('joins the tests another way, and words a change', () => {
    expect(withJoiner(specWith(busy), 'any').condition.kind).toBe('any');
    expect(withJoiner(specWith(dropped), 'any').condition.kind).toBe('change');
    const spec = specWith(dropped);
    if (spec.condition.kind !== 'change') throw new Error('not a change');
    expect(changeTestWords(spec, spec.condition)).toBe('drops by at least 50%');
  });
});

describe('what the chart draws for a condition', () => {
  const points = [
    { at: 0, value: 100, readings: [{ value: 100, reference: null }] },
    { at: 60_000, value: 40, readings: [{ value: 40, reference: 100 }] },
  ];

  test('is the threshold of the first test', () => {
    const above = specWith({ kind: 'threshold', op: 'above', value: 0.02, for: '5m' });
    expect(conditionLines(above.condition, { points })).toEqual({ threshold: 0.02 });
    expect(conditionLines(specWith(busy).condition, { points })).toEqual({ threshold: 0.02 });
    expect(conditionLines({ kind: 'no_data', for: '5m' }, { points })).toEqual({ threshold: null });
  });

  test('is the limit a change must reach, from the earlier point of each evaluation', () => {
    const lines = conditionLines(specWith(dropped).condition, { points });
    expect(lines).toEqual({
      threshold: null,
      limit: {
        name: 'fires below',
        points: [
          { at: 0, value: null },
          { at: 60_000, value: 50 },
        ],
      },
    });
    const named = conditionLines(specWith(dropped).condition, { name: 'checkout', points });
    expect(named.limit?.name).toBe('fires below (checkout)');
    expect(conditionLines(specWith(dropped).condition, undefined)).toEqual({ threshold: null });
  });

  test('is the value a period before and the limit it sets, for a comparison with the past', () => {
    const lines = conditionLines(specWith(lastWeek).condition, { name: 'checkout', points });
    expect(lines).toEqual({
      threshold: null,
      limit: {
        name: 'fires above (checkout)',
        points: [
          { at: 0, value: null },
          { at: 60_000, value: 130 },
        ],
      },
      reference: {
        name: 'a week earlier (checkout)',
        points: [
          { at: 0, value: null },
          { at: 60_000, value: 100 },
        ],
      },
    });
    expect(lineName(specWith(lastWeek).condition)).toBe('fires above this');
  });

  test('is the band of the history at each evaluation, for a band', () => {
    const read = [
      { at: 0, value: 9, readings: [{ value: 9, reference: null, spread: null }] },
      { at: 60_000, value: 14, readings: [{ value: 14, reference: 10, spread: 1 }] },
    ];
    expect(conditionLines(specWith(unusual).condition, { points: read })).toEqual({
      threshold: null,
      band: {
        name: 'usual range',
        points: [
          { at: 0, lower: null, upper: null },
          { at: 60_000, lower: 7, upper: 13 },
        ],
      },
    });
    expect(lineName(specWith(unusual).condition)).toBeNull();
    expect(lineName(specWith(dropped).condition)).toBe('fires below this');
  });
});

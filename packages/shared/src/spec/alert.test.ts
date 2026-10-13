import { describe, expect, test } from 'bun:test';
import { alertSpecSchema, durationMs } from './alert.ts';

/**
 * A valid spec, with fields replaced.
 *
 * @param overrides - Fields to replace.
 * @returns The spec, as JSON.
 */
function spec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    specVersion: 1,
    title: 'Checkout 5xx',
    query: { refId: 'A', connector: 'prometheus', language: 'promql', expr: 'up' },
    condition: { kind: 'threshold', op: 'above', value: 0.05, for: '5m' },
    every: '1m',
    lookback: '10m',
    severity: 'critical',
    message: { title: '{alert} fires', body: '{series} at {value}, {threshold} for {duration}.' },
    ...overrides,
  };
}

/**
 * The paths of the issues a spec raises.
 *
 * @param input - The spec.
 * @returns The paths, dotted.
 */
function issuePaths(input: unknown): string[] {
  const parsed = alertSpecSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('the alert spec', () => {
  test('parses a good spec and fills the defaults', () => {
    const parsed = alertSpecSchema.parse(spec());
    expect(parsed.value).toEqual({ reduce: 'last', maxSeries: 100 });
    expect(parsed.notify).toEqual({ onResolved: true });
    expect(parsed.variables).toEqual([]);
    expect(parsed.channels).toEqual([]);
    expect(parsed.message.fields).toEqual([]);
  });

  test('takes a no-data condition', () => {
    expect(issuePaths(spec({ condition: { kind: 'no_data', for: '10m' } }))).toEqual([]);
  });

  test('refuses durations that are not one', () => {
    expect(issuePaths(spec({ every: '5 minutes' }))).toEqual(['every']);
    expect(issuePaths(spec({ lookback: '1w' }))).toEqual(['lookback']);
    const condition = { kind: 'threshold', op: 'above', value: 1, for: '-1m' };
    expect(issuePaths(spec({ condition }))).toEqual(['condition.for']);
  });

  test('evaluates at most every minute, over a window that covers the condition', () => {
    expect(issuePaths(spec({ every: '30s' }))).toEqual(['every']);
    expect(issuePaths(spec({ lookback: '3m' }))).toEqual(['lookback']);
    expect(issuePaths(spec({ lookback: '8d' }))).toEqual(['lookback']);
  });

  test('repeats no more often than it evaluates', () => {
    const notify = { onResolved: false, repeatEvery: '30s' };
    expect(issuePaths(spec({ every: '5m', notify }))).toEqual(['notify.repeatEvery']);
    expect(issuePaths(spec({ notify: { repeatEvery: '1h' } }))).toEqual([]);
  });

  test('refuses an unknown placeholder in the message', () => {
    const message = { title: '{alert} on {host}', body: 'Down.' };
    expect(issuePaths(spec({ message }))).toEqual(['message.title']);
  });

  test('refuses a variable named twice, and an interval that is not a duration', () => {
    const twice = [
      { name: 'env', value: 'prod' },
      { name: 'env', value: 'staging' },
    ];
    expect(issuePaths(spec({ variables: twice }))).toEqual(['variables.1.name']);
    const interval = [{ name: 'window', value: 'often', interval: true }];
    expect(issuePaths(spec({ variables: interval }))).toEqual(['variables.0.value']);
  });

  test('refuses a key it does not know', () => {
    expect(issuePaths(spec({ script: 'alert()' }))).toEqual(['']);
  });
});

describe('durationMs', () => {
  test('reads seconds, minutes, hours and days', () => {
    expect(['15s', '5m', '1h', '2d'].map(durationMs)).toEqual([
      15_000, 300_000, 3_600_000, 172_800_000,
    ]);
  });

  test('is NaN for anything else', () => {
    expect(durationMs('5 m')).toBeNaN();
    expect(durationMs('1w')).toBeNaN();
  });

  test('takes a change, with a window longer than its span and the latest point as value', () => {
    const change = {
      kind: 'change',
      direction: 'down',
      amount: 50,
      unit: 'percent',
      within: '10m',
      for: '0m',
    };
    expect(issuePaths(spec({ condition: change, lookback: '20m' }))).toEqual([]);
    expect(issuePaths(spec({ condition: change, lookback: '10m' }))).toEqual(['lookback']);
    expect(issuePaths(spec({ condition: { ...change, amount: 0 }, lookback: '20m' }))).toEqual([
      'condition.amount',
    ]);
    const mean = spec({ condition: change, lookback: '20m', value: { reduce: 'mean' } });
    expect(issuePaths(mean)).toEqual(['value.reduce']);
  });

  test('takes two to four tests joined, the first on the alert’s value, never nested', () => {
    const above = { kind: 'threshold', op: 'above', value: 0.02 };
    const requests = {
      kind: 'threshold',
      op: 'above',
      value: 100,
      field: 'requests',
      reduce: 'sum',
    };
    const joined = (of: unknown[], kind = 'all') => spec({ condition: { kind, of, for: '5m' } });
    expect(issuePaths(joined([above, requests]))).toEqual([]);
    expect(issuePaths(joined([above, requests], 'any'))).toEqual([]);
    expect(issuePaths(joined([above]))).toEqual(['condition.of']);
    expect(issuePaths(joined([above, above, above, above, above]))).toEqual(['condition.of']);
    expect(issuePaths(joined([requests, above]))).toEqual([
      'condition.of.0.field',
      'condition.of.0.reduce',
    ]);
    expect(issuePaths(joined([above, { ...above, for: '5m' }]))).toEqual(['condition.of.1']);
    const nested = { kind: 'all', of: [above, above] };
    expect(issuePaths(joined([above, nested]))).toEqual(['condition.of.1.kind']);
  });

  test('checks the span of a change that is a part, and gives it no reducer', () => {
    const above = { kind: 'threshold', op: 'above', value: 5 };
    const rose = { kind: 'change', direction: 'up', amount: 200, unit: 'absolute', within: '15m' };
    const joined = (part: unknown) =>
      spec({ condition: { kind: 'all', of: [above, part], for: '0m' } });
    expect(issuePaths(joined(rose))).toEqual(['lookback']);
    expect(issuePaths({ ...joined(rose), lookback: '30m' })).toEqual([]);
    expect(issuePaths({ ...joined({ ...rose, reduce: 'max' }), lookback: '30m' })).toEqual([
      'condition.of.1',
    ]);
  });

  test('takes a comparison with the past, an hour, a day or a week back', () => {
    const past = { kind: 'past', direction: 'up', amount: 30, unit: 'percent', for: '10m' };
    for (const ago of ['1h', '1d', '7d'])
      expect(issuePaths(spec({ condition: { ...past, ago }, value: { reduce: 'mean' } }))).toEqual(
        [],
      );
    expect(issuePaths(spec({ condition: { ...past, ago: '2d' } }))).toEqual(['condition.ago']);
    expect(issuePaths(spec({ condition: { ...past, ago: '7d', amount: 0 } }))).toEqual([
      'condition.amount',
    ]);
  });

  test('takes a band, its width and its baseline within bounds', () => {
    const band = { kind: 'band', side: 'either', deviations: 3, baseline: '1d', for: '5m' };
    expect(issuePaths(spec({ condition: band }))).toEqual([]);
    expect(issuePaths(spec({ condition: { ...band, baseline: '7d' } }))).toEqual([]);
    expect(issuePaths(spec({ condition: { ...band, baseline: '30m' } }))).toEqual([
      'condition.baseline',
    ]);
    expect(issuePaths(spec({ condition: { ...band, baseline: '8d' } }))).toEqual([
      'condition.baseline',
    ]);
    expect(issuePaths(spec({ condition: { ...band, deviations: 0.2 } }))).toEqual([
      'condition.deviations',
    ]);
    expect(issuePaths(spec({ condition: { ...band, deviations: 11 } }))).toEqual([
      'condition.deviations',
    ]);
    expect(issuePaths(spec({ condition: { ...band, side: 'outside' } }))).toEqual([
      'condition.side',
    ]);
  });

  test('joins one test that reads history with others, never two', () => {
    const above = { kind: 'threshold', op: 'above', value: 100 };
    const past = { kind: 'past', direction: 'up', amount: 30, unit: 'percent', ago: '7d' };
    const band = { kind: 'band', side: 'above', deviations: 3, baseline: '30m', field: 'p99' };
    const joined = (...of: unknown[]) => spec({ condition: { kind: 'all', of, for: '0m' } });
    expect(issuePaths(joined(above, { ...past, field: 'orders', reduce: 'sum' }))).toEqual([]);
    expect(issuePaths(joined(past, above))).toEqual([]);
    expect(issuePaths(joined(above, band))).toEqual(['condition.of.1.baseline']);
    expect(issuePaths(joined(past, { ...band, baseline: '1h' }))).toEqual(['condition.of.1']);
    expect(issuePaths(joined({ ...past, reduce: 'sum' }, above))).toEqual([
      'condition.of.0.reduce',
    ]);
  });
});

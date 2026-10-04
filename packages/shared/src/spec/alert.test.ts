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
});

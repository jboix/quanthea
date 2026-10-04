import { describe, expect, test } from 'bun:test';
import {
  type AlertDetail,
  type AlertSpec,
  alertSpecSchema,
  replayAtThreshold,
} from '@quanthea/shared';
import type { Replayed } from '../alert-draft/index.ts';
import { changeWords, nowComparison, pastComparison } from './unsaved.ts';

const minute = 60_000;

/** The 5xx share of each service, above 2% for 2 minutes, every minute. */
const saved: AlertSpec = alertSpecSchema.parse({
  specVersion: 1,
  title: 'Checkout 5xx rate',
  query: { refId: 'A', connector: 'prom', language: 'promql', expr: 'x' },
  value: { format: { $fmt: 'percent', decimals: 1 }, by: ['service'] },
  condition: { kind: 'threshold', op: 'above', value: 0.02, for: '2m' },
  every: '1m',
  lookback: '5m',
  severity: 'critical',
  message: { title: '{alert}', body: '{value}' },
});

/**
 * The spec with another condition.
 *
 * @param condition - The fields of the condition that change.
 * @param every - The interval.
 * @returns The changed spec.
 */
function tunedTo(condition: Record<string, unknown>, every = '1m'): AlertSpec {
  return { ...saved, every, condition: { ...saved.condition, ...condition } } as AlertSpec;
}

/** Checkout reaches 3% for three minutes, then 2.4% for three more: two firings at 2%. */
const values = [0.01, 0.03, 0.03, 0.03, 0.01, 0.024, 0.024, 0.024, 0.01];
const points = values.map((value, index) => ({ at: index * minute, value }));
const condition = { op: 'above', value: 0.02, for: '2m' } as const;
const replay: Replayed = {
  replayable: true,
  from: 0,
  to: 8 * minute,
  stepMs: minute,
  truncated: false,
  series: [
    {
      key: '{service="checkout-svc"}',
      labels: { service: 'checkout-svc' },
      ...replayAtThreshold(points, condition, '1m', 8 * minute),
    },
  ],
};

/**
 * A series as the alert page reads it now.
 *
 * @param service - Its service.
 * @param state - Its state.
 * @param value - Its value.
 * @param since - Since when, in minutes.
 * @returns The series.
 */
function seriesNow(
  service: string,
  state: AlertDetail['series'][number]['state'],
  value: number | null,
  since = 0,
): AlertDetail['series'][number] {
  return {
    key: `{service="${service}"}`,
    labels: { service },
    state,
    since: since * minute,
    value,
    evaluatedAt: 0,
    notifiedAt: null,
  };
}

describe('the changes not saved yet', () => {
  test('name the values changed, in the alert’s format', () => {
    expect(changeWords(saved, tunedTo({ value: 0.025 }))).toBe('threshold 2% → 2.5%');
    expect(changeWords(saved, tunedTo({ op: 'below' }))).toBe('threshold above 2% → below 2%');
    expect(changeWords(saved, tunedTo({ for: '10m' }, '5m'))).toBe(
      'wait 2 minutes → 10 minutes, checked every minute → every 5 minutes',
    );
  });

  test('say how often it would have fired over the window, replayed at the change', () => {
    expect(replay.series[0]?.firings).toBe(2);
    expect(pastComparison(replay, tunedTo({ value: 0.025 }), 'Last 7 days')).toBe(
      'Last 7 days: would have fired 1 time instead of 2.',
    );
    expect(pastComparison(replay, tunedTo({ value: 0.021 }), 'Last 24 hours')).toBe(
      'Last 24 hours: would still have fired 2 times.',
    );
    expect(pastComparison(replay, tunedTo({ for: '5m' }), 'Last 6 hours')).toBe(
      'Last 6 hours: would have fired 0 times instead of 2.',
    );
  });

  test('say which series would change state now, from their current values', () => {
    const series = [
      seriesNow('checkout-svc', 'firing', 0.034),
      seriesNow('payments-svc', 'ok', 0.007),
      seriesNow('cart-svc', 'pending', 0.022, 9),
      seriesNow('search-svc', 'no_data', null),
    ];
    const now = 10 * minute;
    expect(nowComparison(series, tunedTo({ value: 0.035 }), now)).toBe(
      'Right now: checkout-svc would stop firing; cart-svc would stop pending.',
    );
    expect(nowComparison(series, tunedTo({ value: 0.005 }), now)).toBe(
      'Right now: payments-svc would start pending.',
    );
    expect(nowComparison(series, tunedTo({ value: 0.005, for: '1m' }), now)).toBe(
      'Right now: payments-svc would start pending; cart-svc would fire.',
    );
    expect(nowComparison(series, tunedTo({ value: 0.021 }), now)).toBe(
      'Right now: no series would change state.',
    );
  });

  test('name a few series, and count more', () => {
    const many = ['a', 'b', 'c', 'd'].map((name) => seriesNow(name, 'firing', 0.03));
    expect(nowComparison(many.slice(0, 2), tunedTo({ value: 0.05 }), 0)).toBe(
      'Right now: a and b would stop firing.',
    );
    expect(nowComparison(many, tunedTo({ value: 0.05 }), 0)).toBe(
      'Right now: 4 series would stop firing.',
    );
  });
});

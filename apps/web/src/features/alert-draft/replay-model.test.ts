import { describe, expect, test } from 'bun:test';
import { type AlertSpec, alertSpecSchema } from '@quanthea/shared';
import {
  byFiring,
  type Replayed,
  sampleFiring,
  seriesAt,
  summarize,
  summaryText,
} from './replay-model.ts';

const minute = 60_000;

/** Above 5 for 2 minutes, every minute. */
const spec: AlertSpec = alertSpecSchema.parse({
  specVersion: 1,
  title: 'Errors',
  query: { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT 1' },
  condition: { kind: 'threshold', op: 'above', value: 5, for: '2m' },
  every: '1m',
  lookback: '5m',
  severity: 'warning',
  message: { title: '{alert}', body: '{value}' },
});

/** Checkout goes to 9 for minutes 3 to 6; cart to 6 for one minute at 8. */
const replay: Replayed = {
  replayable: true,
  from: 0,
  to: 10 * minute,
  stepMs: minute,
  truncated: false,
  series: [
    {
      key: '{service="cart"}',
      labels: { service: 'cart' },
      points: Array.from({ length: 11 }, (_unused, at) => ({
        at: at * minute,
        value: at === 8 ? 6 : 1,
      })),
      firing: [],
      firings: 0,
      firingMs: 0,
      tooShort: [{ from: 8 * minute, to: 9 * minute, peak: 6 }],
    },
    {
      key: '{service="checkout"}',
      labels: { service: 'checkout' },
      points: Array.from({ length: 11 }, (_unused, at) => ({
        at: at * minute,
        value: at >= 3 && at <= 6 ? 9 : 1,
      })),
      firing: [{ from: 5 * minute, to: 7 * minute, ongoing: false }],
      firings: 1,
      firingMs: 2 * minute,
      tooShort: [],
    },
  ],
};

describe('a replay at the threshold a person drags', () => {
  test('keeps the server’s result at the saved threshold, the series that fired first', () => {
    const series = byFiring(seriesAt(replay, spec, 5));
    expect(series.map((each) => each.labels.service)).toEqual(['checkout', 'cart']);
    expect(summaryText(summarize(series))).toBe(
      'Would have fired once · 2 minutes in total · 1 spike too short to fire',
    );
  });

  test('replays the values again at a lower threshold', () => {
    const series = seriesAt(replay, spec, 0.5);
    // Every value is above 0.5, so each series fires two minutes in and keeps firing.
    expect(series.map((each) => each.track.firings)).toEqual([1, 1]);
    expect(summaryText(summarize(series))).toBe('Would have fired 2 times · 16 minutes in total');
  });

  test('says when it would not have fired', () => {
    expect(summaryText(summarize(seriesAt(replay, spec, 20)))).toBe('Would not have fired');
  });

  test('fills the previews with the first firing of the series that fired longest', () => {
    expect(sampleFiring(replay)).toEqual({
      labels: { service: 'checkout' },
      value: 9,
      since: 5 * minute,
    });
  });
});

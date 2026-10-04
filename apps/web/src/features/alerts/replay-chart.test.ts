import { expect, test } from 'bun:test';
import { changedSummary, chartInputOf, firingSummary, maxChartSeries } from './replay-chart.ts';
import { listedAlert } from './test-alerts.ts';

/**
 * One series of a replay.
 *
 * @param service - Its label.
 * @param firingMs - How long it fired.
 * @param firings - How many times.
 * @returns The series.
 */
function series(service: string, firingMs: number, firings: number) {
  const firing = firings === 0 ? [] : [{ from: 10, to: 10 + firingMs, ongoing: false }];
  const points = [{ at: 0, value: 0.01 }];
  return { key: service, labels: { service }, points, firing, firings, firingMs, tooShort: [] };
}

const replay = {
  replayable: true as const,
  from: 0,
  to: 100,
  stepMs: 60_000,
  truncated: false,
  series: [series('cart', 0, 0), series('checkout', 54 * 60_000, 2)],
};

test('the chart draws the series that fired longest first, the threshold and the firing periods', () => {
  const input = chartInputOf(replay, listedAlert());
  expect(input.series.map((each) => each.name)).toEqual(['checkout', 'cart']);
  expect(input.threshold).toBe(0.02);
  expect(input.firing).toEqual([{ from: 10, to: 10 + 54 * 60_000 }]);
  expect(input.format(0.034)).toBe('3.4%');
  const many = { ...replay, series: Array.from({ length: 20 }, (_, n) => series(`s${n}`, n, 1)) };
  expect(chartInputOf(many, listedAlert()).series).toHaveLength(maxChartSeries);
  const noData = listedAlert({ condition: { kind: 'no_data', for: '10m' } });
  expect(chartInputOf(replay, noData).threshold).toBeNull();
});

test('says how often and how long the alert fired over the window', () => {
  expect(firingSummary(replay, '24 h')).toBe('Fired 2 times over the last 24 h, 54 min in all.');
  expect(firingSummary({ ...replay, series: [series('cart', 0, 0)] }, '6 h')).toBe(
    'Did not fire over the last 6 h.',
  );
  const once = { ...replay, series: [series('a', 190 * 60_000, 1)] };
  expect(firingSummary(once, '7 d')).toBe('Fired once over the last 7 d, 3 h 10 min in all.');
});

test('says how often it would have fired with the changes not saved', () => {
  expect(changedSummary([{ firings: 1, firingMs: 12 * 60_000 }], '24 h')).toBe(
    'With the changes, it would have fired once over the last 24 h, 12 min in all.',
  );
  expect(changedSummary([], '6 h')).toBe(
    'With the changes, it would not have fired over the last 6 h.',
  );
});

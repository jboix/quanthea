import { describe, expect, test } from 'bun:test';
import { replaySeries } from './replay-core.ts';
import { type ObservedSeries, seriesKeyOf } from './series.ts';
import { minute, spec } from './test/fixtures.ts';

/** Fires above 5 once it held for 3 minutes, evaluated every minute over the last 3 minutes. */
const threshold = spec({
  condition: { kind: 'threshold', op: 'above', value: 5, for: '3m' },
  lookback: '3m',
});

/** Twenty minutes, evaluated every minute. */
const window = { from: 0, to: 20 * minute, stepMs: minute };

/**
 * A series with one point a minute.
 *
 * @param labels - Its labels.
 * @param values - The value at each minute from 0; `null` for no point.
 * @returns The series.
 */
function perMinute(labels: Record<string, string>, values: (number | null)[]): ObservedSeries {
  const points = values.flatMap((value, index) =>
    value === null ? [] : [{ at: index * minute, value }],
  );
  return { key: seriesKeyOf(labels), labels, points };
}

describe('replaying a threshold', () => {
  // Above at 3 to 4 (too short), 10 to 16 (fires at 13), 19 to 20 (pending at the end).
  const values = Array.from({ length: 21 }, (_unused, at) =>
    [3, 4, 10, 11, 12, 13, 14, 15, 16, 19, 20].includes(at) ? 6 + (at % 3) : 1,
  );

  test('finds when it would have fired, and for how long', () => {
    const [series] = replaySeries(threshold, [perMinute({ service: 'checkout' }, values)], window);
    expect(series?.firing).toEqual([{ from: 13 * minute, to: 17 * minute, ongoing: false }]);
    expect(series?.firings).toBe(1);
    expect(series?.firingMs).toBe(4 * minute);
  });

  test('finds the spikes too short to fire, with their peak', () => {
    const [series] = replaySeries(threshold, [perMinute({ service: 'checkout' }, values)], window);
    expect(series?.tooShort).toEqual([{ from: 3 * minute, to: 5 * minute, peak: 7 }]);
  });

  test('gives the value at each evaluation', () => {
    const [series] = replaySeries(threshold, [perMinute({}, values)], window);
    expect(series?.points).toHaveLength(21);
    expect(series?.points[3]).toEqual({ at: 3 * minute, value: 6 });
  });

  test('counts a firing still going at the end up to the end', () => {
    const late = Array.from({ length: 21 }, (_unused, at) => (at >= 15 ? 9 : 1));
    const [series] = replaySeries(threshold, [perMinute({}, late)], window);
    expect(series?.firing).toEqual([{ from: 18 * minute, to: 20 * minute, ongoing: true }]);
    expect(series?.firingMs).toBe(2 * minute);
  });

  test('replays each series on its own', () => {
    const quiet = perMinute({ service: 'cart' }, Array(21).fill(1));
    const busy = perMinute({ service: 'checkout' }, Array(21).fill(9));
    const replayed = replaySeries(threshold, [quiet, busy], window);
    expect(replayed.map((each) => [each.labels.service, each.firings])).toEqual([
      ['cart', 0],
      ['checkout', 1],
    ]);
  });

  test('reads the window of each evaluation, so a sparse series keeps its last point', () => {
    const sparse = perMinute({}, [9, null, null, 9, null, null, 9, null, null, 9]);
    const [series] = replaySeries(threshold, [sparse], { ...window, to: 9 * minute });
    expect(series?.points.map((point) => point.value)).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    expect(series?.firing[0]?.from).toBe(3 * minute);
  });
});

describe('replaying a no-data condition', () => {
  test('fires once no point came for long enough', () => {
    const noData = spec({ condition: { kind: 'no_data', for: '3m' }, lookback: '3m' });
    const stops = perMinute({}, [1, 1, 1, 1, 1, 1]);
    const [series] = replaySeries(noData, [stops], window);
    expect(series?.key).toBe('');
    expect(series?.firing).toEqual([{ from: 11 * minute, to: 20 * minute, ongoing: true }]);
  });
});

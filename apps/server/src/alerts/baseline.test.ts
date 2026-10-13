import { describe, expect, test } from 'bun:test';
import { bandHolds } from '@quanthea/shared';
import { baselineReader, minBaselinePoints } from './baseline.ts';
import { minute } from './test/fixtures.ts';

const hour = 60 * minute;
const everything = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY] as const;

/**
 * Points a minute apart.
 *
 * @param values - The values, in time order.
 * @returns The points, the first at minute 1.
 */
function everyMinute(values: readonly number[]) {
  return values.map((value, index) => ({ at: (index + 1) * minute, value }));
}

describe('the baseline of a series', () => {
  test('is the mean and the standard deviation of its points', () => {
    const read = baselineReader(everyMinute([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    const baseline = read(...everything, 10 * minute);
    expect(baseline?.mean).toBeCloseTo(5.5, 12);
    expect(baseline?.deviation).toBeCloseTo(Math.sqrt(8.25), 12);
  });

  test('reads the points from the start to the end, both included, whatever their order', () => {
    const points = everyMinute(Array.from({ length: 30 }, (_, index) => index + 1)).reverse();
    const baseline = baselineReader(points)(10 * minute, 20 * minute, 10 * minute);
    expect(baseline?.mean).toBeCloseTo(15, 12);
    expect(baselineReader(points)(10 * minute + 1, 22 * minute - 1, 8 * minute)?.mean).toBeCloseTo(
      16,
      12,
    );
  });

  test('is none with fewer points than it needs', () => {
    const few = everyMinute(Array.from({ length: minBaselinePoints - 1 }, () => 4));
    expect(baselineReader(few)(...everything, minute)).toBeNull();
    expect(baselineReader([])(...everything, minute)).toBeNull();
  });

  test('is none when its points span less than half its length', () => {
    const young = everyMinute(Array.from({ length: 20 }, () => 4));
    expect(baselineReader(young)(...everything, hour)).toBeNull();
    expect(baselineReader(young)(...everything, 38 * minute)).not.toBeNull();
  });

  test('leaves out points without a time', () => {
    const untimed = Array.from({ length: 20 }, () => ({ at: null, value: 4 }));
    expect(baselineReader(untimed)(...everything, minute)).toBeNull();
  });

  test('of a flat series has no spread, and its own value is not outside the band', () => {
    const flat = baselineReader(everyMinute(Array.from({ length: 30 }, () => 0.1)));
    const baseline = flat(...everything, 20 * minute);
    expect(baseline?.deviation).toBeLessThan(1e-12);
    const reading = { value: 0.1, reference: baseline?.mean, spread: baseline?.deviation };
    expect(bandHolds({ side: 'either', deviations: 3 }, reading)).toBe(false);
    expect(bandHolds({ side: 'either', deviations: 3 }, { ...reading, value: 0.11 })).toBe(true);
  });

  test('keeps the spread of large values that differ a little', () => {
    const values = Array.from({ length: 1000 }, (_, index) => 1e9 + (index % 2));
    const baseline = baselineReader(everyMinute(values))(501 * minute, 600 * minute, hour);
    expect(baseline?.mean).toBeCloseTo(1e9 + 0.5, 3);
    expect(baseline?.deviation).toBeCloseTo(0.5, 6);
  });
});

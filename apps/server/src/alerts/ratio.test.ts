import { describe, expect, test } from 'bun:test';
import { divide, divisorFor, labelsAgree, ratioReading } from './ratio.ts';
import type { ObservedSeries } from './series.ts';

/**
 * A series of the second query with one point.
 *
 * @param labels - Its labels.
 * @param value - Its value.
 * @returns The series.
 */
function total(labels: Record<string, string>, value = 1): ObservedSeries {
  return { key: JSON.stringify(labels), labels, points: [{ at: 0, value }] };
}

describe('dividing one value by another', () => {
  test('gives the ratio, signs and fractions included', () => {
    expect(divide(12, 480, 'zero')).toBe(0.025);
    expect(divide(-3, 4, 'zero')).toBe(-0.75);
    expect(divide(0, 480, 'no_value')).toBe(0);
  });

  test('by 0 is 0, or no value when the spec says so, whatever is divided', () => {
    expect(divide(0, 0, 'zero')).toBe(0);
    expect(divide(7, 0, 'zero')).toBe(0);
    expect(divide(0, 0, 'no_value')).toBeNull();
    expect(divide(7, 0, 'no_value')).toBeNull();
  });

  test('has no value when either side is missing', () => {
    expect(divide(null, 480, 'zero')).toBeNull();
    expect(divide(12, null, 'zero')).toBeNull();
    expect(divide(undefined, undefined, 'zero')).toBeNull();
  });
});

describe('the reading of a ratio', () => {
  test('keeps both sides beside the value', () => {
    expect(ratioReading({ value: 12 }, { value: 480 }, 'zero')).toEqual({
      value: 0.025,
      numerator: 12,
      denominator: 480,
    });
  });

  test('keeps the first side when the second has no series, so the series is still seen', () => {
    expect(ratioReading({ value: 12 }, { value: null }, 'zero')).toEqual({
      value: null,
      numerator: 12,
      denominator: null,
    });
  });

  test('divides the earlier points of a change too, each side by its own', () => {
    const first = { value: 30, reference: 10 };
    expect(ratioReading(first, { value: 100, reference: 200 }, 'zero')).toEqual({
      value: 0.3,
      reference: 0.05,
      numerator: 30,
      denominator: 100,
    });
    expect(ratioReading(first, { value: 100, reference: null }, 'zero').reference).toBeNull();
    expect(ratioReading(first, { value: 100, reference: 0 }, 'no_value').reference).toBeNull();
  });
});

describe('matching series by their labels', () => {
  test('compares the labels both carry, and no other', () => {
    expect(labelsAgree({ service: 'a', code: '500' }, { service: 'a' })).toBe(true);
    expect(labelsAgree({ service: 'a' }, { service: 'a', region: 'eu' })).toBe(true);
    expect(labelsAgree({ service: 'a' }, { service: 'b' })).toBe(false);
    expect(labelsAgree({ service: 'a' }, {})).toBe(true);
    expect(labelsAgree({ service: 'a' }, { region: 'eu' })).toBe(true);
  });

  test('divides a series by the one series that agrees with it', () => {
    const totals = [total({ service: 'a' }, 10), total({ service: 'b' }, 20)];
    expect(divisorFor({ service: 'b', code: '500' }, totals)?.points[0]?.value).toBe(20);
    expect(divisorFor({ service: 'c' }, totals)).toBeUndefined();
  });

  test('divides every series by a total without labels', () => {
    expect(divisorFor({ service: 'a' }, [total({}, 99)])?.points[0]?.value).toBe(99);
  });

  test('gives none when the second query tells apart what the first does not', () => {
    const byRegion = [total({ service: 'a', region: 'eu' }), total({ service: 'a', region: 'us' })];
    expect(divisorFor({ service: 'a' }, byRegion)).toBeUndefined();
    expect(divisorFor({ service: 'a' }, [])).toBeUndefined();
  });
});

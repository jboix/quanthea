import { describe, expect, test } from 'bun:test';
import type { Dataset } from '@quanthea/shared';
import { hasNoPoint, intervalOf, lonePointDots, withHoles } from './gaps.ts';

const hour = 3_600_000;
const t0 = Date.parse('2026-10-12T00:00:00Z');

/**
 * A dataset of a time and a value.
 *
 * @param rows - Pairs of hours after midnight and values.
 * @returns The dataset.
 */
function hourly(rows: readonly (readonly [number, number | null])[]): Dataset {
  return {
    dimensions: [
      { name: 'time', type: 'time' },
      { name: 'value', type: 'number' },
    ],
    source: rows.map(([hours, value]) => [t0 + hours * hour, value]),
  };
}

describe('intervalOf', () => {
  test('is the smallest step when most rows are that far apart', () => {
    expect(intervalOf([0, 1, 2, 3, 10].map((hours) => hours * hour))).toBe(hour);
    expect(intervalOf([0, 1, 9].map((hours) => hours * hour))).toBe(hour);
  });

  test('is none for rows at the times of events, and for fewer than two times', () => {
    expect(intervalOf([0, 1, 7, 20, 31, 64, 65.5])).toBeUndefined();
    expect(intervalOf([t0])).toBeUndefined();
    expect(intervalOf([t0, t0])).toBeUndefined();
  });

  test('takes months for one interval, whatever their days', () => {
    const months = ['01', '02', '03', '04', '05'].map((month) => Date.parse(`2026-${month}-01`));
    expect(intervalOf(months)).toBe(28 * 24 * hour);
    const dataset = {
      dimensions: hourly([]).dimensions,
      source: months.map((time) => [time, 1]),
    };
    expect(withHoles(dataset, 'time')).toBe(dataset);
  });
});

describe('withHoles', () => {
  test('puts a row of missing values in a hole wider than one interval', () => {
    const dataset = hourly([
      [0, 4],
      [1, 5],
      [2, 6],
      [9, 7],
      [10, 8],
    ]);
    expect(withHoles(dataset, 'time').source).toEqual([
      [t0, 4],
      [t0 + hour, 5],
      [t0 + 2 * hour, 6],
      [t0 + 3 * hour, null],
      [t0 + 9 * hour, 7],
      [t0 + 10 * hour, 8],
    ]);
  });

  test('leaves rows one interval apart as they are', () => {
    const dataset = hourly([
      [0, 4],
      [1, 5],
      [2, 6],
    ]);
    expect(withHoles(dataset, 'time')).toBe(dataset);
  });

  test('leaves rows on no interval, out of order or without the column as they are', () => {
    const events = hourly([
      [0, 1],
      [0.1, 1],
      [3, 1],
      [11, 1],
      [30, 1],
    ]);
    expect(withHoles(events, 'time')).toBe(events);
    const unordered = hourly([
      [2, 1],
      [0, 1],
      [9, 1],
    ]);
    expect(withHoles(unordered, 'time')).toBe(unordered);
    expect(withHoles(events, 'day')).toBe(events);
  });
});

describe('lonePointDots', () => {
  test('draw a dot on the values with none before or after', () => {
    const rows = [
      [0, 1],
      [1, null],
      [2, 3],
      [3, null],
      [4, 5],
      [5, 6],
      [6, null],
      [7, 8],
    ];
    const dots = lonePointDots(rows, 1);
    expect(dots).toMatchObject({ showSymbol: true, showAllSymbol: true, symbol: 'circle' });
    const size = dots.symbolSize as (value: unknown, point: { dataIndex: number }) => number;
    expect(rows.map((_row, dataIndex) => size(null, { dataIndex }))).toEqual([
      5, 0, 5, 0, 0, 0, 0, 5,
    ]);
    expect(lonePointDots([[0, 1]], 1).showSymbol).toBe(true);
  });

  test('change nothing of a line every point of which has a neighbour', () => {
    expect(
      lonePointDots(
        [
          [0, 1],
          [1, 2],
        ],
        1,
      ),
    ).toEqual({});
  });
});

describe('hasNoPoint', () => {
  test('is true without rows and with only missing values', () => {
    expect(hasNoPoint(hourly([]), 'time')).toBe(true);
    expect(
      hasNoPoint(
        hourly([
          [0, null],
          [1, null],
        ]),
        'time',
      ),
    ).toBe(true);
  });

  test('is false once a value is there, a 0 too', () => {
    expect(
      hasNoPoint(
        hourly([
          [0, null],
          [1, 0],
        ]),
        'time',
      ),
    ).toBe(false);
  });
});

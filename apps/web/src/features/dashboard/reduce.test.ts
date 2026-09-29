import { describe, expect, test } from 'bun:test';
import type { Frame } from '@querent/shared';
import { columnValues, reduceResult, reduceValues } from './reduce.ts';

const frame: Frame = {
  refId: 'A',
  fields: [
    { name: 'Time', type: 'time' },
    { name: 'Value', type: 'number' },
  ],
  values: [
    [1, 2, 3],
    [0.003, 0.084, null],
  ],
  meta: { rowCount: 3, truncated: false, durationMs: 1 },
};

describe('reductions', () => {
  test('reduce finite numbers only', () => {
    const values = [3, null, 1, Number.NaN, 8, 'x'];
    expect(
      ['first', 'last', 'max', 'min', 'sum', 'mean', 'count'].map((reduce) =>
        reduceValues(values, reduce as never),
      ),
    ).toEqual([3, 8, 8, 1, 12, 4, 3]);
    expect(reduceValues([], 'max')).toBeUndefined();
    expect(reduceValues([], 'count')).toBe(0);
  });

  test('read the first number field unless the view names one', () => {
    expect(columnValues([frame])).toEqual([0.003, 0.084, null]);
    expect(columnValues([frame], 'Time')).toEqual([1, 2, 3]);
    expect(columnValues([frame], 'missing')).toEqual([]);
  });

  test('reduce a named result of the panel', () => {
    const queries = [{ refId: 'A', frames: [frame], error: null }];
    expect(reduceResult(queries, 'A', 'max')).toBe(0.084);
    expect(reduceResult(queries, 'A', 'first')).toBe(0.003);
    expect(reduceResult(queries, 'B', 'max')).toBeUndefined();
  });
});

describe('reading results as datasets', () => {
  const series: Frame = {
    refId: 'A',
    name: '{}',
    fields: [
      { name: 'time', type: 'time' },
      { name: 'Value', type: 'number', labels: {} },
    ],
    values: [
      [1, 2],
      [3, 5],
    ],
    meta: { rowCount: 2, truncated: false, durationMs: 1 },
  };

  test('read a Prometheus series by the column charts name, value, and by its old name, Value', () => {
    expect(
      reduceResult([{ refId: 'A', frames: [series], error: null }], 'A', 'last', 'value'),
    ).toBe(5);
    expect(reduceResult([{ refId: 'A', frames: [series], error: null }], 'A', 'max', 'Value')).toBe(
      5,
    );
    expect(columnValues([series])).toEqual([3, 5]);
  });
});

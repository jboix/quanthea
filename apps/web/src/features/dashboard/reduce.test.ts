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

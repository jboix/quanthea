import { describe, expect, test } from 'bun:test';
import type { Frame } from '@quanthea/plugin-kit/contract';
import { mappedResult, reduceResult, reduceValues, resultColumn } from './stat.ts';

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
    expect(resultColumn([frame])).toEqual([0.003, 0.084, null]);
    expect(resultColumn([frame], 'Time')).toEqual([1, 2, 3]);
    expect(resultColumn([frame], 'missing')).toEqual([]);
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
    expect(resultColumn([series])).toEqual([3, 5]);
  });
});

describe('the value a stat maps', () => {
  /**
   * The outcomes of one query that returns one column.
   *
   * @param type - The column's type.
   * @param values - Its values, row after row.
   * @returns The outcomes.
   */
  function outcomes(type: 'string' | 'number' | 'boolean', values: unknown[]) {
    const column: Frame = {
      refId: 'A',
      fields: [{ name: 'state', type }],
      values: [values],
      meta: { rowCount: values.length, truncated: false, durationMs: 1 },
    };
    return [{ refId: 'A', frames: [column], error: null }];
  }

  test('is the column’s own value with first and last: a text or a boolean is kept', () => {
    const states = outcomes('string', ['starting', 'ready', 'degraded']);
    expect(mappedResult(states, 'A', 'first', 'state')).toBe('starting');
    expect(mappedResult(states, 'A', 'last', 'state')).toBe('degraded');
    expect(mappedResult(outcomes('boolean', [false, true]), 'A', 'last', 'state')).toBe(true);
    expect(reduceResult(states, 'A', 'last', 'state')).toBeUndefined();
  });

  test('is undefined for a result without a row or without a value, which a null match reads', () => {
    expect(mappedResult(outcomes('number', []), 'A', 'last')).toBeUndefined();
    expect(mappedResult(outcomes('number', [null]), 'A', 'first')).toBeUndefined();
    expect(mappedResult(outcomes('number', [4]), 'B', 'last')).toBeUndefined();
  });

  test('is the number the stat shows, for a column of numbers and for every other reduction', () => {
    const queries = [{ refId: 'A', frames: [frame], error: null }];
    for (const reduce of ['first', 'last', 'max', 'min', 'mean', 'sum', 'count'] as const)
      expect(mappedResult(queries, 'A', reduce)).toBe(reduceResult(queries, 'A', reduce));
    const texts = outcomes('string', ['a', 'b']);
    expect(mappedResult(texts, 'A', 'count', 'state')).toBe(0);
    expect(mappedResult(texts, 'A', 'max', 'state')).toBeUndefined();
  });
});

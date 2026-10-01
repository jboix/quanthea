import { describe, expect, test } from 'bun:test';
import { type Frame, frameProblems } from './frames.ts';

const valid: Frame = {
  refId: 'A',
  fields: [
    { name: 'time', type: 'time' },
    { name: 'value', type: 'number', labels: { service: 'checkout-svc' } },
    { name: 'route', type: 'string' },
  ],
  values: [
    [1_000, 2_000],
    [0.5, null],
    ['GET /cart', 'POST /checkout'],
  ],
  meta: { rowCount: 2, truncated: false, durationMs: 3 },
};

describe('frameProblems', () => {
  test('accepts a valid frame, with nulls for missing values', () => {
    expect(frameProblems(valid)).toEqual([]);
  });

  test('reports a missing value column', () => {
    expect(frameProblems({ ...valid, values: valid.values.slice(0, 2) })).toEqual([
      '3 fields but 2 value columns',
    ]);
  });

  test('reports a column whose length is not the row count', () => {
    expect(frameProblems({ ...valid, meta: { ...valid.meta, rowCount: 3 } })).toEqual([
      'field "time" has 2 values for 3 rows',
      'field "value" has 2 values for 3 rows',
      'field "route" has 2 values for 3 rows',
    ]);
  });

  test('reports a value of the wrong type, and a non-finite number', () => {
    expect(
      frameProblems({
        ...valid,
        values: [
          [1_000, 'noon'],
          [0.5, Number.NaN],
          ['a', 'b'],
        ],
      }),
    ).toEqual(['field "time" row 1 is not a time', 'field "value" row 1 is not a number']);
  });

  test('reports a malformed frame', () => {
    expect(frameProblems({ refId: '' })[0]).toStartWith('refId:');
  });
});

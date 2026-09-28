import { describe, expect, test } from 'bun:test';
import { frameProblems } from '@querent/shared';
import type { ExecutionContext } from '../_shared/index.ts';
import { maxSeries, sampleValue, seriesName, toFrames } from './frames.ts';

const context: ExecutionContext = {
  refId: 'A',
  signal: new AbortController().signal,
  timeoutMs: 1000,
  maxRows: 1000,
  timeRange: { from: new Date(0), to: new Date(60_000) },
};

describe('toFrames', () => {
  test('turns each series of a range query into a frame, labels on the value field', () => {
    const frames = toFrames(
      {
        resultType: 'matrix',
        result: [
          {
            metric: { __name__: 'up', job: 'api' },
            values: [
              [1, '1'],
              [2, 'NaN'],
            ],
          },
          { metric: { job: 'db' }, values: [[1, '+Inf']] },
        ],
      },
      context,
      5,
    );
    expect(frames.map(frameProblems)).toEqual([[], []]);
    expect(frames[0]).toMatchObject({
      refId: 'A',
      name: 'up{job="api"}',
      fields: [
        { name: 'time', type: 'time' },
        { name: 'Value', type: 'number', labels: { job: 'api' } },
      ],
      values: [
        [1000, 2000],
        [1, null],
      ],
    });
    expect(frames[1]?.values[1]).toEqual([null]);
  });

  test('keeps maxRows points per series and marks the frame truncated', () => {
    const [frame] = toFrames(
      {
        resultType: 'matrix',
        result: [
          {
            metric: {},
            values: [
              [1, '1'],
              [2, '2'],
              [3, '3'],
            ],
          },
        ],
      },
      { ...context, maxRows: 2 },
      0,
    );
    expect(frame?.meta).toMatchObject({ rowCount: 2, truncated: true });
  });

  test('drops series past the cap and marks the last frame truncated', () => {
    const result = Array.from({ length: maxSeries + 5 }, (_unused, index) => ({
      metric: { index: String(index) },
      values: [[1, '1']] as [number, string][],
    }));
    const frames = toFrames({ resultType: 'matrix', result }, context, 0);
    expect(frames).toHaveLength(maxSeries);
    expect(frames.at(-1)?.meta.truncated).toBe(true);
    expect(frames[0]?.meta.truncated).toBe(false);
  });

  test('turns an instant query into one table: a column per label, then the value', () => {
    const [frame] = toFrames(
      {
        resultType: 'vector',
        result: [
          { metric: { route: 'POST /checkout', service: 'checkout-svc' }, value: [1, '2.9'] },
          { metric: { route: 'GET /cart' }, value: [1, '0.64'] },
        ],
      },
      context,
      0,
    );
    expect(frameProblems(frame)).toEqual([]);
    expect(frame?.fields.map((field) => field.name)).toEqual(['route', 'service', 'Value']);
    expect(frame?.values).toEqual([
      ['POST /checkout', 'GET /cart'],
      ['checkout-svc', null],
      [2.9, 0.64],
    ]);
  });

  test('turns a scalar into one point', () => {
    const [frame] = toFrames({ resultType: 'scalar', result: [2, '42'] }, context, 0);
    expect(frame?.values).toEqual([[2000], [42]]);
  });
});

describe('helpers', () => {
  test('sampleValue maps non-finite values to null', () => {
    expect([sampleValue('0.084'), sampleValue('NaN'), sampleValue('-Inf')]).toEqual([
      0.084,
      null,
      null,
    ]);
  });

  test('seriesName shows the metric name and labels', () => {
    expect(seriesName({ __name__: 'up', job: 'api' })).toBe('up{job="api"}');
    expect(seriesName({})).toBe('{}');
  });
});

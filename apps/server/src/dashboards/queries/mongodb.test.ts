import { describe, expect, test } from 'bun:test';
import type { PanelQuery } from '@querent/shared';
import { bindTemplate } from '../../query/bind.ts';
import { buildData } from './build.ts';
import { dataSchema } from './request.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Builds a MongoDB request over `events`.
 *
 * @param data - The request, without its connector and collection.
 * @returns The query and its output.
 */
function built(data: Record<string, unknown>) {
  return buildData(dataSchema.parse({ connector: 'shop', collection: 'events', ...data }));
}

/**
 * The pipeline of a built query.
 *
 * @param query - The query.
 * @returns The stages.
 */
function pipelineOf(query: PanelQuery | undefined): readonly Record<string, unknown>[] {
  if (query?.language !== 'mongodb') throw new Error('Not a MongoDB query.');
  return query.pipeline;
}

describe('the MongoDB builders', () => {
  test('match the range and filters, numbers and booleans as typed too', () => {
    const [match] = pipelineOf(
      built({
        kind: 'mongodb-stat',
        time: 'at',
        filters: [
          { field: 'status', value: '500' },
          { field: 'live', op: '!=', value: 'true' },
          { field: 'platform', value: '$platform' },
          { field: 'media.id', op: '!~', value: '^urn:demo' },
        ],
      }).queries[0],
    );
    expect(match).toEqual({
      $match: {
        $and: [
          { at: { $gte: { $var: '__from' }, $lt: { $var: '__to' } } },
          { status: { $in: ['500', 500] } },
          { live: { $nin: ['true', true] } },
          { platform: { $in: { $var: 'platform', as: 'list' } } },
          { 'media.id': { $not: { $regex: '^urn:demo' } } },
        ],
      },
    });
  });

  test('bucket time by a literal duration, a variable or the built-in width', () => {
    const binSize = (interval?: string) => {
      const [, group] = pipelineOf(
        built({ kind: 'mongodb-series', time: 'at', ...(interval ? { interval } : {}) }).queries[0],
      );
      return (group as { $group: { _id: { time: { $dateTrunc: { binSize: unknown } } } } }).$group
        ._id.time.$dateTrunc.binSize;
    };
    expect(binSize('5m')).toBe(300_000);
    expect(binSize('$interval')).toEqual({ $var: 'interval', as: 'ms' });
    expect(binSize()).toEqual({ $var: '__interval_ms', as: 'ms' });
  });

  test('count a ratio with conditions, and need a time field over time', () => {
    const { queries, output } = built({
      kind: 'mongodb-ratio',
      over: 'range',
      match: [{ field: 'event', value: 'ERROR' }],
      of: [{ field: 'event', value: 'START' }],
    });
    expect(pipelineOf(queries[0])[1]).toEqual({
      $group: {
        _id: null,
        _matching: { $sum: { $cond: [{ $and: [{ $in: ['$event', ['ERROR']] }] }, 1, 0] } },
        _total: { $sum: { $cond: [{ $and: [{ $in: ['$event', ['START']] }] }, 1, 0] } },
      },
    });
    expect(output).toMatchObject({ shape: 'single', columns: ['value'], unit: 'percent' });
    expect(() => built({ kind: 'mongodb-ratio', match: [{ field: 'a', value: 'b' }] })).toThrow(
      'needs a time field',
    );
  });

  test('pass the MongoDB binder', () => {
    const variables = { platform: { value: 'Web' }, interval: { value: '5m', duration: true } };
    for (const data of [
      { kind: 'mongodb-series', by: 'platform', interval: '$interval' },
      { kind: 'mongodb-ratio', match: [{ field: 'p', value: '$platform' }], by: 'p' },
      { kind: 'mongodb-breakdown', by: 'p', measure: { fn: 'percentiles', field: 'ms' } },
      { kind: 'mongodb-histogram', field: 'ms', width: 10 },
      { kind: 'mongodb-rows', fields: ['_id', 'at'] },
    ]) {
      const [query] = built({ time: 'at', ...data }).queries;
      if (!query) throw new Error('Nothing was built.');
      expect(() => bindTemplate(query, variables, timeRange)).not.toThrow();
    }
  });
});

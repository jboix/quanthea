import { describe, expect, test } from 'bun:test';
import { bindMongodb } from './mongodb-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a pipeline over `orders` with some variables over the fixed time range.
 *
 * @param pipeline - The stages.
 * @param variables - The variable values.
 * @param collection - The collection.
 * @returns The bound query.
 */
function bind(
  pipeline: Record<string, unknown>[],
  variables: Record<string, string | string[]> = {},
  collection = 'orders',
) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindMongodb({ collection, pipeline }, bindings, timeRange);
}

describe('bindMongodb', () => {
  test('keeps operators, and puts variables and the time range in as JSON values', () => {
    expect(
      bind(
        [
          {
            $match: {
              status: { $in: { $var: 'status' } },
              created_at: { $gte: { $var: '__from' }, $lt: { $var: '__to' } },
            },
          },
          {
            $group: {
              _id: {
                $dateTrunc: {
                  date: '$created_at',
                  unit: 'millisecond',
                  binSize: { $var: '__interval_ms' },
                },
              },
              n: { $sum: 1 },
            },
          },
        ],
        { status: ['paid', 'failed'] },
      ),
    ).toEqual({
      language: 'mongodb',
      collection: 'orders',
      pipeline: [
        {
          $match: {
            status: { $in: ['paid', 'failed'] },
            created_at: {
              $gte: { $date: '2026-09-27T12:00:00.000Z' },
              $lt: { $date: '2026-09-27T13:00:00.000Z' },
            },
          },
        },
        {
          $group: {
            _id: { $dateTrunc: { date: '$created_at', unit: 'millisecond', binSize: 5000 } },
            n: { $sum: 1 },
          },
        },
      ],
    });
  });

  test('gives a duration variable in milliseconds with "as": "ms"', () => {
    const stage = (name: string) => ({
      $group: {
        _id: { $dateTrunc: { date: '$t', unit: 'millisecond', binSize: { $var: name, as: 'ms' } } },
      },
    });
    const binSize = (pipeline: unknown) =>
      (pipeline as [{ $group: { _id: { $dateTrunc: { binSize: unknown } } } }])[0].$group._id
        .$dateTrunc.binSize;
    expect(binSize(bind([stage('interval')], { interval: '5m' }).pipeline)).toBe(300_000);
    expect(binSize(bind([stage('__interval_ms')]).pipeline)).toBe(5000);
    expect(() => bind([stage('service')], { service: 'checkout' })).toThrow('not a duration');
  });

  test('keeps a value one string, whatever it holds', () => {
    const attack = '{"$where": "sleep(1000)"}';
    expect(bind([{ $match: { status: { $var: 'status' } } }], { status: attack }).pipeline).toEqual(
      [{ $match: { status: attack } }],
    );
  });

  test('keeps a value that starts with $ literal where it would read a field', () => {
    const condition = { $eq: ['$level', { $var: 'level' }] };
    const pipeline = [
      { $match: { level: { $var: 'level' }, $expr: condition } },
      { $addFields: { tag: { $var: 'level' }, list: { $var: 'levels' } } },
      { $project: { kept: { $literal: { $var: 'level' } }, plain: { $var: 'service' } } },
    ];
    const variables = { level: '$secret', levels: ['error', '$$ROOT'], service: 'checkout' };
    expect(bind(pipeline, variables).pipeline).toEqual([
      { $match: { level: '$secret', $expr: { $eq: ['$level', { $literal: '$secret' }] } } },
      { $addFields: { tag: { $literal: '$secret' }, list: { $literal: ['error', '$$ROOT'] } } },
      { $project: { kept: { $literal: '$secret' }, plain: 'checkout' } },
    ]);
  });

  test('refuses stages that write, wait or list, and operators that run JavaScript', () => {
    for (const stage of [
      { $out: 'copy' },
      { $merge: { into: 'copy' } },
      { $changeStream: {} },
      { $currentOp: {} },
      { $match: { $where: 'true' } },
      { $project: { x: { $function: { body: 'return 1', args: [], lang: 'js' } } } },
      { $lookup: { from: 'b', pipeline: [{ $out: 'copy' }], as: 'b' } },
      { $planCacheStats: {} },
      { $listCatalog: {} },
      { $queryStats: {} },
      { $indexStats: {} },
      { $collStats: { count: {} } },
      { $listSearchIndexes: {} },
      { $listClusterCatalog: {} },
    ])
      expect(() => bind([stage])).toThrow(/only reads/);
  });

  test('refuses a system collection that a stage reads, at any depth', () => {
    const nested = (stage: Record<string, unknown>) => ({
      $facet: { a: [{ $lookup: { from: 'items', pipeline: [stage], as: 'i' } }] },
    });
    for (const stage of [
      { $unionWith: 'system.js' },
      { $unionWith: { coll: 'system.profile', pipeline: [] } },
      { $unionWith: { coll: 'orders', db: 'admin' } },
      { $lookup: { from: 'system.profile', localField: 'a', foreignField: 'b', as: 'p' } },
      { $lookup: { from: { db: 'admin', coll: 'users' }, pipeline: [], as: 'p' } },
      { $graphLookup: { from: 'system.js', startWith: '$a', connectFromField: 'a', as: 'g' } },
      nested({ $unionWith: 'system.js' }),
      { $unionWith: { coll: 'items', pipeline: [{ $lookup: { from: 'system.js', as: 'j' } }] } },
    ])
      expect(() => bind([stage])).toThrow(/collection/);
    const allowed = [
      { $lookup: { from: 'items', localField: 'a', foreignField: 'b', as: 'i' } },
      { $lookup: { pipeline: [{ $documents: [{ a: 1 }] }], as: 'd' } },
      { $unionWith: { coll: 'archive', pipeline: [{ $match: {} }] } },
      { $unionWith: 'archive' },
      { $unionWith: { pipeline: [{ $documents: [{ a: 1 }] }] } },
      { $graphLookup: { from: 'items', startWith: '$a', connectFromField: 'a', as: 'g' } },
    ];
    for (const stage of allowed) expect(() => bind([stage])).not.toThrow();
  });

  test('refuses malformed stages and collections', () => {
    expect(() => bind([{ $match: {}, $limit: 1 }])).toThrow(/Stage 1/);
    expect(() => bind([{ match: {} }])).toThrow(/Stage 1/);
    expect(() => bind([], {}, 'system.users')).toThrow(/collection/);
    expect(() => bind([], {}, 'a/b')).toThrow(/collection/);
    expect(() => bind([{ $match: { x: { $var: 'nope' } } }])).toThrow(/Unknown variable/);
  });
});

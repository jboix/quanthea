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

  test('keeps a value one string, whatever it holds', () => {
    const attack = '{"$where": "sleep(1000)"}';
    expect(bind([{ $match: { status: { $var: 'status' } } }], { status: attack }).pipeline).toEqual(
      [{ $match: { status: attack } }],
    );
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
    ])
      expect(() => bind([stage])).toThrow(/only reads/);
  });

  test('refuses malformed stages and collections', () => {
    expect(() => bind([{ $match: {}, $limit: 1 }])).toThrow(/Stage 1/);
    expect(() => bind([{ match: {} }])).toThrow(/Stage 1/);
    expect(() => bind([], {}, 'system.users')).toThrow(/collection/);
    expect(() => bind([], {}, 'a/b')).toThrow(/collection/);
    expect(() => bind([{ $match: { x: { $var: 'nope' } } }])).toThrow(/Unknown variable/);
  });
});

import { describe, expect, test } from 'bun:test';
import { bindMongodb } from './mongodb-binder.ts';
import { bindRedis } from './redis-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a MongoDB pipeline over `orders`, with a viewer's value for `$v`.
 *
 * @param pipeline - The stages.
 * @param value - The value of the variable `v`.
 * @returns The bound query.
 */
function pipelineOf(pipeline: Record<string, unknown>[], value = 'x') {
  return bindMongodb({ collection: 'orders', pipeline }, { v: { value } }, timeRange);
}

describe('a MongoDB pipeline that writes or runs code', () => {
  test('is refused wherever the stage or the operator sits', () => {
    const out = { $out: 'copy' };
    const js = { body: 'function() { return 1 }', args: [], lang: 'js' };
    for (const stage of [
      out,
      { $out: { db: 'other', coll: 'copy' } },
      { $merge: { into: 'copy', whenMatched: 'replace' } },
      { $facet: { a: [out] } },
      { $lookup: { from: 'b', as: 'b', pipeline: [{ $merge: { into: 'copy' } }] } },
      { $unionWith: { coll: 'b', pipeline: [out] } },
      { $lookup: { from: 'b', as: 'b', pipeline: [{ $facet: { deep: [out] } }] } },
      { $addFields: { x: { $function: js } } },
      { $match: { $expr: { $function: js } } },
      { $match: { $where: 'this.total > 0' } },
      { $match: { $or: [{ $where: 'true' }] } },
      { $group: { _id: null, x: { $accumulator: { init: 'function() {}', lang: 'js' } } } },
      { $setWindowFields: { output: { x: { $accumulator: { lang: 'js' } } } } },
    ])
      expect(() => pipelineOf([stage]), JSON.stringify(stage)).toThrow(/only reads/);
  });

  test("a viewer's value that names a stage or an operator stays a value", () => {
    for (const value of ['$out', '$merge', '$where', '{"$out":"copy"}', '$$ROOT']) {
      const { pipeline } = pipelineOf([{ $match: { status: { $var: 'v' } } }], value);
      expect(pipeline).toEqual([{ $match: { status: value } }]);
      const set = pipelineOf([{ $addFields: { label: { $var: 'v' } } }], value).pipeline;
      // In an expression a text that starts with $ would read a field, so it goes in $literal.
      const placed = value.startsWith('$') ? { $literal: value } : value;
      expect(set).toEqual([{ $addFields: { label: placed } }]);
    }
  });

  test('another database, a system collection and a stage of several keys are refused', () => {
    for (const stage of [
      { $lookup: { from: { db: 'admin', coll: 'system.users' }, as: 'u', pipeline: [] } },
      { $unionWith: { db: 'admin', coll: 'secrets' } },
      { $unionWith: 'system.profile' },
      { $graphLookup: { from: 'system.js', startWith: '$a', connectFromField: 'a', as: 'x' } },
      { $match: {}, $out: 'copy' },
    ])
      expect(() => pipelineOf([stage]), JSON.stringify(stage)).toThrow();
  });
});

describe('a Valkey command outside the read set', () => {
  test('is refused, in any case and however it is padded', () => {
    for (const command of [
      'SET',
      'set',
      'Del',
      'UNLINK',
      'EXPIRE',
      'INCR',
      'HSET',
      'LPUSH',
      'XADD',
      'ZRANGESTORE',
      'SORT',
      'SORT_RO',
      'GEORADIUS',
      'GETDEL',
      'GETEX',
      'GETSET',
      'EVAL',
      'EVAL_RO',
      'EVALSHA',
      'FCALL',
      'FCALL_RO',
      'FUNCTION',
      'SCRIPT',
      'CONFIG',
      'ACL',
      'DEBUG',
      'MIGRATE',
      'REPLICAOF',
      'SHUTDOWN',
      'FLUSHDB',
      'FLUSHALL',
      'KEYS',
      'SCAN',
      'MONITOR',
      'SUBSCRIBE',
      'MULTI',
      'CLIENT',
      'SELECT',
      'GET ',
      ' GET',
      'GET\r\nSET',
      'GET SET',
      '',
    ])
      expect(() => bindRedis({ command, args: ['k', 'v'] }, {}, timeRange), command).toThrow(
        'read commands only',
      );
  });

  test('an argument that spells a command stays one argument', () => {
    const args = ['key\r\nFLUSHALL\r\n', 'STORE', 'EVAL'];
    expect(bindRedis({ command: 'GET', args }, {}, timeRange)).toEqual({
      language: 'redis',
      command: 'GET',
      args,
    });
  });
});

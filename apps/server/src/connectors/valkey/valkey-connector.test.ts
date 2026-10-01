import { describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import type { RedisQuery } from '../_shared/index.ts';
import { groupKeys, patternOf } from './catalog.ts';
import { frameOf, tableOf } from './frames.ts';
import { toConnectorError } from './session.ts';
import { valkeyConnector } from './valkey-connector.ts';

testConnectorConformance(valkeyConnector, {
  config: { host: 'valkey', username: 'dash_ro' },
  secret: { password: 'x' },
  query: { language: 'redis', command: 'GET', args: ['k'] },
  invalidQuery: { language: 'redis', command: 'GET', args: [] },
  sampleField: { entity: 'service:*', field: 'key' },
  timeRange: { from: new Date(0), to: new Date(1000) },
  live: false,
});

const context = {
  refId: 'A',
  signal: AbortSignal.timeout(1000),
  timeoutMs: 1000,
  maxRows: 100,
  timeRange: { from: new Date(0), to: new Date(1000) },
};

/**
 * A bound command.
 *
 * @param command - The command.
 * @param args - Its arguments.
 * @returns The query.
 */
function redis(command: string, ...args: string[]): RedisQuery {
  return { language: 'redis', command, args };
}

describe('valkey answers as tables', () => {
  test('give one value, key and value pairs, fields and values', () => {
    expect(tableOf(redis('GET', 'k'), '42')).toEqual({ columns: ['value'], rows: [['42']] });
    expect(tableOf(redis('MGET', 'a', 'b'), ['1', null]).rows).toEqual([
      ['a', '1'],
      ['b', null],
    ]);
    expect(tableOf(redis('HMGET', 'h', 'x', 'y'), ['1', '2']).rows).toEqual([
      ['x', '1'],
      ['y', '2'],
    ]);
    expect(tableOf(redis('HGETALL', 'h'), { a: '1' }).rows).toEqual([['a', '1']]);
    expect(tableOf(redis('HGETALL', 'h'), ['a', '1', 'b', '2']).rows).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
  });

  test('give members with or without scores, and stream entries with their time and fields', () => {
    expect(tableOf(redis('ZRANGE', 'z', '0', '-1', 'WITHSCORES'), [['a', 2]])).toEqual({
      columns: ['member', 'score'],
      rows: [['a', 2]],
    });
    expect(tableOf(redis('ZRANGE', 'z', '0', '-1'), ['a', 'b']).columns).toEqual(['member']);
    const frame = frameOf(
      redis('XRANGE', 's', '-', '+'),
      [
        ['1790510400000-0', ['requests', '10', 'errors', '1']],
        ['1790510460000-0', ['requests', '12', 'note', 'x']],
      ],
      context,
      5,
    );
    expect(frame.fields).toEqual([
      { name: 'id', type: 'string' },
      { name: 'time', type: 'time' },
      { name: 'requests', type: 'number' },
      { name: 'errors', type: 'number' },
      { name: 'note', type: 'string' },
    ]);
    expect(frame.values[1]).toEqual([1790510400000, 1790510460000]);
    expect(frame.values[3]).toEqual([1, null]);
  });

  test('read INFO line by line, with its section', () => {
    const table = tableOf(
      redis('INFO'),
      '# Server\r\nvalkey_version:9.0.6\r\n\r\n# Clients\r\nconnected_clients:3\r\n',
    );
    expect(table.rows).toEqual([
      ['Server', 'valkey_version', '9.0.6'],
      ['Clients', 'connected_clients', '3'],
    ]);
  });
});

describe('valkey catalog', () => {
  test('groups keys by their last segment, and names a lone key by itself', () => {
    expect(patternOf('service:checkout-svc')).toBe('service:*');
    expect(patternOf('deploys')).toBe('deploys');
    const groups = groupKeys([
      ['service:b', 'hash'],
      ['service:a', 'hash'],
      ['service:c', 'string'],
      ['deploys', 'stream'],
    ]);
    expect(groups.map((group) => [group.pattern, group.type, group.keys])).toEqual([
      ['deploys', 'stream', ['deploys']],
      ['service:*', 'hash', ['service:a', 'service:b']],
      ['service:c', 'string', ['service:c']],
    ]);
  });
});

describe('valkey errors', () => {
  test('map server errors to codes with messages that quote no key', () => {
    const cases: [string, string][] = [
      ["NOPERM User dash_ro has no permissions to access the 'secret' key", 'permission'],
      ['WRONGPASS invalid username-password pair or user is disabled.', 'authentication'],
      ['WRONGTYPE Operation against a key holding the wrong kind of value', 'syntax'],
      ["ERR wrong number of arguments for 'get' command", 'syntax'],
      ['Connection closed', 'unreachable'],
      ['ERR something secret', 'internal'],
    ];
    for (const [message, code] of cases) {
      const error = toConnectorError(new Error(message));
      expect(error).toMatchObject({ code });
      expect(error.safeMessage).not.toContain('secret');
    }
  });
});

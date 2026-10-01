import { describe, expect, test } from 'bun:test';
import { bindRedis } from './redis-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a Redis command with some variables over the fixed time range.
 *
 * @param command - The command.
 * @param args - Its arguments.
 * @param variables - The variable values.
 * @returns The bound query.
 */
function bind(command: string, args: string[], variables: Record<string, string | string[]> = {}) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindRedis({ command, args }, bindings, timeRange);
}

describe('bindRedis', () => {
  test('puts variables in arguments, expands a multi-value one alone, and the time range', () => {
    expect(
      bind('mget', ['service:$service', '$keys'], { service: 'checkout', keys: ['a', 'b'] }),
    ).toEqual({
      language: 'redis',
      command: 'MGET',
      args: ['service:checkout', 'a', 'b'],
    });
    expect(bind('XRANGE', ['deploys', '$__from_ms', '$__to_ms']).args).toEqual([
      'deploys',
      '1790510400000',
      '1790514000000',
    ]);
  });

  test('keeps a value one argument, whatever it holds', () => {
    const attack = 'x\r\nFLUSHALL\r\n';
    expect(bind('GET', ['$key'], { key: attack }).args).toEqual([attack]);
  });

  test('refuses commands that write, scan every key or run scripts', () => {
    for (const command of [
      'SET',
      'DEL',
      'FLUSHALL',
      'KEYS',
      'SCAN',
      'EVAL',
      'SORT',
      'CONFIG',
      'ACL',
    ])
      expect(() => bind(command, [])).toThrow('read commands only');
  });

  test('refuses unknown variables and several values inside text', () => {
    expect(() => bind('GET', ['$nope'])).toThrow('Unknown variable $nope.');
    expect(() => bind('GET', ['k:$s'], { s: ['a', 'b'] })).toThrow('has several values');
  });
});

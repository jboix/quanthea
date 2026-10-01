import { describe, expect, test } from 'bun:test';
import { bindSql } from './sql-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds an InfluxDB template with some variables over the fixed time range.
 *
 * @param template - The SQL template.
 * @param variables - The variable values.
 * @returns The bound query.
 */
function bind(template: string, variables: Record<string, string | string[]> = {}) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindSql(template, bindings, timeRange, 'influxdb');
}

describe('bindSql for InfluxDB placeholders', () => {
  test('binds a variable once to a named placeholder, and leaves literals alone', () => {
    const template =
      "SELECT :env AS a, ':env' AS b, $$:env$$ AS c FROM http /* :env /* nested */ */ WHERE env = :env AND time BETWEEN :__from AND :__to";
    expect(bind(template, { env: 'prod' })).toEqual({
      language: 'sql',
      text: "SELECT $p1 AS a, ':env' AS b, $$:env$$ AS c FROM http /* :env /* nested */ */ WHERE env = $p1 AND time BETWEEN $p2 AND $p3",
      parameters: ['prod', timeRange.from, timeRange.to],
    });
  });

  test('refuses a parameter the template writes itself', () => {
    for (const template of ['SELECT $p1', 'SELECT $1', 'SELECT * FROM t WHERE a = $service'])
      expect(() => bind(template)).toThrow('not $name.');
    expect(() => bind('SELECT $tag$ $p1 $tag$')).not.toThrow();
  });

  test('a value never becomes SQL text', () => {
    for (const attack of ["' OR '1'='1", '$$; DROP TABLE t; $$', '$p2']) {
      const bound = bind('SELECT * FROM t WHERE s = :s', { s: attack });
      expect(bound.text).toBe('SELECT * FROM t WHERE s = $p1');
      expect(bound.parameters).toEqual([attack]);
    }
  });
});

import { describe, expect, test } from 'bun:test';
import { bindSql } from './sql-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a ClickHouse template with some variables over the fixed time range.
 *
 * @param template - The SQL template.
 * @param variables - The variable values.
 * @returns The bound query.
 */
function bind(template: string, variables: Record<string, string | string[]> = {}) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindSql(template, bindings, timeRange, 'clickhouse');
}

describe('bindSql for ClickHouse placeholders', () => {
  test('binds a variable once to a typed, numbered placeholder, and the range as UTC times', () => {
    expect(
      bind('SELECT :env AS a, :env AS b WHERE t BETWEEN :__from AND :__to', { env: 'prod' }),
    ).toEqual({
      language: 'sql',
      text: "SELECT {p1:String} AS a, {p1:String} AS b WHERE t BETWEEN {p2:DateTime64(3, 'UTC')} AND {p3:DateTime64(3, 'UTC')}",
      parameters: ['prod', timeRange.from, timeRange.to],
    });
  });

  test('expands a multi-value variable, and an empty one to NULL', () => {
    const bound = bind('SELECT 1 WHERE a IN (:s) OR b IN (:none)', { s: ['x', 'y'], none: [] });
    expect(bound.text).toBe('SELECT 1 WHERE a IN ({p1:String}, {p2:String}) OR b IN (NULL)');
    expect(bound.parameters).toEqual(['x', 'y']);
  });

  test('leaves strings, heredocs, quoted names, comments and casts alone', () => {
    const template = [
      "SELECT ':a' AS s, 'it\\'s :b' AS e, \":c \\\" :d\" AS d, `x:y` AS `q\\`:z`,",
      '$$ :h $$ AS h, $tag$ :i $$ $tag$ AS i, a$$b AS j, 5::String AS c, 1 ? 2 : 3 AS t,',
      '1--1 :f',
      '# :g',
      '/* :k /* :l */ :m */ FROM t WHERE x = :x',
    ].join('\n');
    const bound = bind(template, { x: '1' });
    expect(bound.parameters).toEqual(['1']);
    expect(bound.text).toBe(template.replace(':x', '{p1:String}'));
  });

  test('refuses a {name:Type} written in the template', () => {
    for (const template of ['SELECT {id:UInt64}', "SELECT {'a': 1}", 'SELECT 1 WHERE {x}']) {
      expect(() => bind(template)).toThrow(
        'Use named variables such as :service, not {name:Type}.',
      );
    }
  });

  test('refuses an unterminated string, heredoc, identifier or comment', () => {
    expect(() => bind("SELECT 'abc\\'")).toThrow('unterminated');
    expect(() => bind('SELECT $$abc')).toThrow('unterminated');
    expect(() => bind('SELECT `abc\\`')).toThrow('unterminated');
    expect(() => bind('SELECT 1 /* a /* b */')).toThrow('unterminated');
  });
});

describe('bindSql for ClickHouse statement check', () => {
  test('sees keywords hidden from a lexer that misreads nesting, -- or backslashes', () => {
    expect(() => bind('SELECT 1 /* /* */ ; DROP TABLE t; */')).not.toThrow();
    expect(() => bind('SELECT 1 /* /* */ */ ; DROP TABLE t')).toThrow('one statement only');
    expect(() => bind('SELECT 1--1\n; DROP TABLE t')).toThrow('one statement only');
    expect(() => bind("SELECT 'a\\' ; DROP TABLE t; -- '")).not.toThrow();
  });

  test('refuses a SETTINGS clause, which could lift the limits', () => {
    expect(() => bind('SELECT * FROM t SETTINGS max_result_rows = 0')).toThrow(
      'A query cannot change settings',
    );
    expect(() => bind('SELECT `settings` FROM t')).not.toThrow();
  });

  test('refuses writes and statements that are not reads', () => {
    expect(() => bind('SELECT * FROM t INTO OUTFILE "x"')).toThrow('"INTO" is not allowed');
    for (const sql of ['OPTIMIZE TABLE t', 'SYSTEM FLUSH LOGS', 'KILL QUERY ALL', 'SET a = 1'])
      expect(() => bind(sql)).toThrow('A query starts with SELECT, WITH, VALUES or TABLE.');
  });
});

describe('bindSql for ClickHouse injection', () => {
  const attacks = ["' OR '1'='1", "\\'; DROP TABLE t; -- ", '{p1:String}', '`x`', '$$ x $$'];

  for (const attack of attacks) {
    test(`a value never becomes SQL text: ${JSON.stringify(attack)}`, () => {
      const bound = bind('SELECT * FROM t WHERE service = :service', { service: attack });
      expect(bound.text).toBe('SELECT * FROM t WHERE service = {p1:String}');
      expect(bound.parameters).toEqual([attack]);
    });
  }
});

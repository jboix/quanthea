import { describe, expect, test } from 'bun:test';
import { bindSql } from './sql-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a Trino template with some variables over the fixed time range.
 *
 * @param template - The SQL template.
 * @param variables - The variable values.
 * @returns The bound query.
 */
function bind(template: string, variables: Record<string, string | string[]> = {}) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindSql(template, bindings, timeRange, 'trino');
}

describe('bindSql for Trino placeholders', () => {
  test('binds each use of a variable to its own ? placeholder, in order', () => {
    expect(
      bind('SELECT :env AS a, :env AS b WHERE t BETWEEN :__from AND :__to', { env: 'prod' }),
    ).toEqual({
      language: 'sql',
      text: 'SELECT ? AS a, ? AS b WHERE t BETWEEN ? AND ?',
      parameters: ['prod', 'prod', timeRange.from, timeRange.to],
    });
  });

  test('leaves standard strings, quoted names and comments alone, backslashes included', () => {
    const template = [
      "SELECT ':a' AS s, 'a\\' AS e, ':b''s' AS q, \":c\"\":d\" AS d,",
      '1--1 :f',
      '/* :g /* :h */ FROM t WHERE x = :x',
    ].join('\n');
    const bound = bind(template, { x: '1' });
    expect(bound.parameters).toEqual(['1']);
    expect(bound.text).toBe(template.replace(':x', '?'));
  });

  test('refuses a ? written in the template, and an unterminated literal', () => {
    expect(() => bind('SELECT * FROM t WHERE id = ?')).toThrow('not ?.');
    expect(() => bind("SELECT 'abc''")).toThrow('unterminated');
    expect(() => bind('SELECT 1 /* never closed')).toThrow('unterminated');
  });
});

describe('bindSql for Trino statement check', () => {
  test('sees keywords a lexer with backslash escapes or nested comments would hide', () => {
    expect(() => bind("SELECT 'a\\' ; DROP TABLE t; -- '")).toThrow('one statement only');
    expect(() => bind('SELECT 1 /* /* */ ; DROP TABLE t; */')).toThrow('one statement only');
  });

  test('refuses writes and statements that are not reads', () => {
    expect(() => bind('SELECT * FROM t; INSERT INTO t VALUES (1)')).toThrow('one statement only');
    for (const sql of ['CALL system.flush()', 'SET SESSION a = 1', 'EXECUTE q', 'PREPARE q FROM x'])
      expect(() => bind(sql)).toThrow('A query starts with SELECT, WITH, VALUES or TABLE.');
  });
});

describe('bindSql for Trino injection', () => {
  const attacks = ["' OR '1'='1", "\\'; DROP TABLE t; -- ", '?', '"x"', "'' USING 1"];

  for (const attack of attacks) {
    test(`a value never becomes SQL text: ${JSON.stringify(attack)}`, () => {
      const bound = bind('SELECT * FROM t WHERE service = :service', { service: attack });
      expect(bound.text).toBe('SELECT * FROM t WHERE service = ?');
      expect(bound.parameters).toEqual([attack]);
    });
  }
});

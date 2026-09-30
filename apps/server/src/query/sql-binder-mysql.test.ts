import { describe, expect, test } from 'bun:test';
import { bindSql } from './sql-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a MySQL template with some variables over the fixed time range.
 *
 * @param template - The SQL template.
 * @param variables - The variable values.
 * @returns The bound query.
 */
function bind(template: string, variables: Record<string, string | string[]> = {}) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindSql(template, bindings, timeRange, 'mysql');
}

describe('bindSql for MySQL placeholders', () => {
  test('binds each use of a variable to its own ? placeholder, in order', () => {
    expect(
      bind('SELECT :env AS a, :env AS b WHERE t BETWEEN :__from AND :__to', { env: 'prod' }),
    ).toEqual({
      language: 'sql',
      text: 'SELECT ? AS a, ? AS b WHERE t BETWEEN ? AND ?',
      parameters: ['prod', 'prod', timeRange.from, timeRange.to],
    });
  });

  test('expands a multi-value variable at each use', () => {
    const bound = bind('SELECT 1 WHERE a IN (:s) OR b IN (:s)', { s: ['x', 'y'] });
    expect(bound.text).toBe('SELECT 1 WHERE a IN (?, ?) OR b IN (?, ?)');
    expect(bound.parameters).toEqual(['x', 'y', 'x', 'y']);
  });

  test('leaves strings, backticked names and comments alone', () => {
    const template = [
      "SELECT ':a' AS s, 'it\\'s :b' AS e, \":c \\\" :d\" AS d, `x:y` AS `q``:z`,",
      '1--1 AS arithmetic, @v := 2 # :f',
      '-- :g',
      '/* :h */ /*+ BKA(t) */ FROM t WHERE x = :x',
    ].join('\n');
    const bound = bind(template, { x: '1' });
    expect(bound.parameters).toEqual(['1']);
    expect(bound.text).toBe(template.replace(':x', '?'));
  });

  test('refuses a ? written in the template', () => {
    expect(() => bind('SELECT * FROM t WHERE id = ?')).toThrow(
      'Use named variables such as :service, not ?.',
    );
  });

  test('refuses executable comments, whose content the server runs', () => {
    expect(() => bind('SELECT 1 /*! , (SELECT 2) */')).toThrow('Executable comments');
    expect(() => bind('SELECT 1 /*!50001 FOR UPDATE */')).toThrow('Executable comments');
    expect(() => bind('SELECT 1 /*M! , 2 */')).toThrow('Executable comments');
  });

  test('refuses an unterminated string, identifier or comment', () => {
    expect(() => bind("SELECT 'abc\\'")).toThrow('unterminated');
    expect(() => bind('SELECT `abc')).toThrow('unterminated');
    expect(() => bind('SELECT 1 /* never closed')).toThrow('unterminated');
  });
});

describe('bindSql for MySQL statement check', () => {
  test('sees keywords hidden from a lexer that misreads backslashes or --', () => {
    expect(() => bind("SELECT 'a\\' ; DELETE FROM t; -- '")).not.toThrow();
    expect(() => bind('SELECT 1--1\n; DELETE FROM t')).toThrow('one statement only');
  });

  test('refuses writes hidden inside a read', () => {
    expect(() => bind('SELECT * INTO OUTFILE "/tmp/x" FROM t')).toThrow('"INTO" is not allowed');
    expect(() => bind('SELECT * FROM t FOR UPDATE')).toThrow('"UPDATE" is not allowed');
  });

  test('refuses statements that are not reads', () => {
    ['REPLACE INTO t VALUES (1)', 'LOAD DATA INFILE "x" INTO TABLE t', 'CALL p()', 'DO 1'].forEach(
      (sql) => {
        expect(() => bind(sql)).toThrow('A query starts with SELECT, WITH, VALUES or TABLE.');
      },
    );
  });
});

describe('bindSql for MySQL injection', () => {
  const attacks = ["' OR '1'='1", "\\'; DROP TABLE t; -- ", '?', '`x`', '/*! DELETE FROM t */'];

  for (const attack of attacks) {
    test(`a value never becomes SQL text: ${JSON.stringify(attack)}`, () => {
      const bound = bind('SELECT * FROM t WHERE service = :service', { service: attack });
      expect(bound.text).toBe('SELECT * FROM t WHERE service = ?');
      expect(bound.parameters).toEqual([attack]);
    });
  }
});

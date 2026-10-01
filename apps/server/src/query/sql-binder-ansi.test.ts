import { describe, expect, test } from 'bun:test';
import type { SqlPlaceholderStyle } from '../connectors/_shared/index.ts';
import { bindSql } from './sql-binder.ts';
import { sqlFlavorOf } from './sql-dialects.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a standard SQL template in a placeholder style over the fixed time range.
 *
 * @param placeholders - The style.
 * @param template - The SQL template.
 * @param variables - The variable values.
 * @returns The bound query.
 */
function bind(
  placeholders: SqlPlaceholderStyle,
  template: string,
  variables: Record<string, string | string[]> = {},
) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindSql(template, bindings, timeRange, {
    dialect: 'ansi',
    placeholders,
    rowLimit: 'fetch',
  });
}

const template = 'SELECT :env AS a, :env AS b FROM t WHERE x BETWEEN :__from AND :__to';

describe('bindSql for standard SQL', () => {
  test('writes each placeholder style, a numbered one binding a variable once', () => {
    expect(bind('?', template, { env: 'prod' })).toEqual({
      language: 'sql',
      text: 'SELECT ? AS a, ? AS b FROM t WHERE x BETWEEN ? AND ?',
      parameters: ['prod', 'prod', timeRange.from, timeRange.to],
    });
    expect(bind('$1', template, { env: 'prod' }).text).toBe(
      'SELECT $1 AS a, $1 AS b FROM t WHERE x BETWEEN $2 AND $3',
    );
    expect(bind(':1', template, { env: 'prod' }).text).toBe(
      'SELECT :1 AS a, :1 AS b FROM t WHERE x BETWEEN :2 AND :3',
    );
    expect(bind('@p1', template, { env: 'prod' })).toEqual({
      language: 'sql',
      text: 'SELECT @p1 AS a, @p1 AS b FROM t WHERE x BETWEEN @p2 AND @p3',
      parameters: ['prod', timeRange.from, timeRange.to],
    });
  });

  test('refuses a placeholder the template writes itself, in its style', () => {
    expect(() => bind('?', 'SELECT * FROM t WHERE a = ?')).toThrow('not ?');
    expect(() => bind('$1', 'SELECT * FROM t WHERE a = $1')).toThrow('not $1');
    expect(() => bind(':1', 'SELECT * FROM t WHERE a = :1')).toThrow('not :1');
    expect(() => bind('@p1', 'SELECT * FROM t WHERE a = @p1')).toThrow('not @p1');
    expect(bind(':1', "SELECT '12:30' AS t FROM x").text).toBe("SELECT '12:30' AS t FROM x");
  });

  test('lexes standard literals only: doubled quotes, no backslash escapes', () => {
    const literal = 'SELECT \':a\' AS s, \'a\\\' AS e, ":b""" AS d -- :c\nFROM t WHERE x = :x';
    const bound = bind('?', literal, { x: '1' });
    expect(bound.parameters).toEqual(['1']);
    expect(bound.text).toBe(literal.replace(':x', '?'));
  });

  test('is one read statement, as for every dialect', () => {
    expect(() => bind('?', 'SELECT 1; DELETE FROM t')).toThrow('one statement');
    expect(() => bind('?', 'ATTACH DATABASE :f AS x', { f: 'x' })).toThrow('starts with SELECT');
  });

  test('refuses what reaches other files from a read-only connection, anywhere in the code', () => {
    for (const template of [
      "ATTACH DATABASE '/data/querent.db' AS q",
      "SELECT 1; ATTACH DATABASE '/data/querent.db' AS q",
      "VACUUM INTO '/tmp/copy.db'",
      'PRAGMA user_version = 5',
      "SELECT load_extension('/tmp/evil')",
      "WITH x AS (SELECT 1) SELECT load_extension('/tmp/evil') FROM x",
      'SELECT * FROM t /* */ DETACH',
    ])
      expect(() => bind('?', template)).toThrow(/one statement|starts with SELECT|cannot attach/);
    expect(bind('?', "SELECT 'attach', name FROM pragma_table_info('t')").text).toBe(
      "SELECT 'attach', name FROM pragma_table_info('t')",
    );
  });

  test('takes its styles from the kind, with ? and fetch by default', () => {
    expect(sqlFlavorOf({ dialect: 'ansi' })).toEqual({
      dialect: 'ansi',
      placeholders: '?',
      rowLimit: 'fetch',
    });
    expect(sqlFlavorOf({ dialect: 'postgres' })).toBe('postgres');
    expect(sqlFlavorOf({})).toBeUndefined();
  });
});

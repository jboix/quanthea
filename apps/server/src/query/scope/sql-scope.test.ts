import { describe, expect, test } from 'bun:test';
import type { ObjectVisibility } from '@quanthea/shared';
import { QueryError } from '../query-error.ts';
import type { SqlFlavor } from '../sql-dialects.ts';
import { scopeOf } from './object-scope.ts';
import { checkSqlScope } from './sql-scope.ts';
import { sqlReads } from './sql-tables.ts';
import { sqlTokens } from './sql-tokens.ts';

/**
 * The tables a statement names, joined with dots.
 *
 * @param sql - The statement.
 * @param flavor - The dialect.
 * @returns The names, in order.
 */
function tablesOf(sql: string, flavor: SqlFlavor = 'postgres'): string[] {
  return sqlReads(sqlTokens(sql, flavor)).tables.map((parts) => parts.join('.'));
}

/**
 * Why a statement is refused, if it is.
 *
 * @param sql - The statement.
 * @param visibility - The connector's visibility; the default when not given.
 * @param flavor - The dialect.
 * @returns The message, or `undefined` when the statement passes.
 */
function refusal(
  sql: string,
  visibility: Partial<ObjectVisibility> = {},
  flavor: SqlFlavor = 'postgres',
): string | undefined {
  const scope = scopeOf(
    { showSystem: false, mode: 'except', names: [], ...visibility },
    'sql',
    flavor,
  );
  try {
    checkSqlScope(scope, sql, flavor);
    return undefined;
  } catch (error) {
    if (error instanceof QueryError) return error.safeMessage;
    throw error;
  }
}

describe('sqlReads', () => {
  test('finds the tables after FROM, JOIN and a comma', () => {
    expect(tablesOf('SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id')).toEqual([
      'orders',
      'customers',
    ]);
    expect(tablesOf('SELECT 1 FROM a, analytics.b AS x LEFT JOIN "My Table" t ON true')).toEqual([
      'a',
      'analytics.b',
      'My Table',
    ]);
  });

  test('finds the tables of subqueries, unions and TABLE', () => {
    expect(
      tablesOf(
        'SELECT (SELECT max(x) FROM a) FROM (SELECT * FROM b) s WHERE y IN (SELECT y FROM c) UNION SELECT * FROM d',
      ),
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(tablesOf('TABLE secret')).toEqual(['secret']);
    expect(tablesOf('SELECT 1 WHERE x IN (TABLE secret)')).toEqual(['secret']);
  });

  test('leaves out the names a WITH clause defines, in its own scope only', () => {
    expect(
      tablesOf(
        'WITH recent AS (SELECT * FROM orders), top (id) AS (SELECT id FROM recent) SELECT * FROM top',
      ),
    ).toEqual(['orders']);
    expect(
      tablesOf('SELECT * FROM secret, (WITH secret AS (SELECT 1) SELECT * FROM secret) s'),
    ).toEqual(['secret']);
    expect(
      tablesOf('WITH a AS (SELECT * FROM secret), secret AS (SELECT 1) SELECT * FROM a'),
    ).toEqual(['secret']);
  });

  test('does not take a FROM inside a function, or a column, for a table', () => {
    expect(
      tablesOf(
        "SELECT extract(epoch FROM created_at), substring(name FROM 2), trim(FROM name), a IS DISTINCT FROM b, t.from FROM orders t WHERE status = 'from secret' ORDER BY a, b",
      ),
    ).toEqual(['orders']);
    expect(tablesOf('SELECT * FROM orders -- from secret\n WHERE 1 = 1 /* join secret */')).toEqual(
      ['orders'],
    );
  });

  test('reads through grouped joins, LATERAL and ONLY', () => {
    expect(
      tablesOf('SELECT * FROM (a JOIN b ON true) JOIN LATERAL (SELECT * FROM c) x ON true, ONLY d'),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  test('keeps a function where a table goes apart from tables', () => {
    const reads = sqlReads(
      sqlTokens(
        'SELECT * FROM generate_series(1, 3) g, orders, pg_catalog.pg_ls_dir(1)',
        'postgres',
      ),
    );
    expect(reads.tables).toEqual([['orders']]);
    expect(reads.tableFunctions).toEqual([['generate_series'], ['pg_catalog', 'pg_ls_dir']]);
  });

  test('reads backtick names and a FROM before SELECT in ClickHouse', () => {
    expect(tablesOf('FROM `db`.`events` SELECT count() ', 'clickhouse')).toEqual(['db.events']);
    expect(tablesOf('SELECT x FROM events ARRAY JOIN tags AS x, more', 'clickhouse')).toEqual([
      'events',
    ]);
    expect(tablesOf('SELECT 1 FROM a STRAIGHT_JOIN b', 'mysql')).toEqual(['a', 'b']);
    expect(tablesOf('SELECT 1 FROM DUAL', 'mysql')).toEqual([]);
  });
});

describe('checkSqlScope', () => {
  test('hides the system schemas of each dialect by default', () => {
    expect(refusal('SELECT * FROM orders')).toBeUndefined();
    expect(refusal('SELECT * FROM pg_catalog.pg_user')).toContain('pg_catalog.pg_user');
    expect(refusal('SELECT * FROM pg_user')).toContain('pg_user');
    expect(refusal('SELECT * FROM Information_Schema.tables')).toContain('does not show');
    expect(refusal('SELECT * FROM _timescaledb_internal.chunk_1')).toContain('does not show');
    expect(refusal('SELECT * FROM pg_stat_get_activity(NULL)')).toContain('pg_stat_get_activity');
    expect(refusal('SELECT * FROM mysql.user', {}, 'mysql')).toContain('mysql.user');
    expect(refusal('SELECT * FROM performance_schema.threads', {}, 'mysql')).toBeDefined();
    expect(refusal('SELECT * FROM system.query_log', {}, 'clickhouse')).toBeDefined();
    expect(refusal('SELECT * FROM system.runtime.queries', {}, 'trino')).toBeDefined();
    expect(refusal('SELECT * FROM hive.information_schema.tables', {}, 'trino')).toBeDefined();
    expect(refusal('SELECT * FROM information_schema.columns', {}, 'influxdb')).toBeDefined();
    const ansi = { dialect: 'ansi', placeholders: '?', rowLimit: 'limit' } as const;
    expect(refusal('SELECT * FROM information_schema.tables', {}, ansi)).toBeDefined();
    expect(refusal('SELECT * FROM system.t', {}, ansi)).toBeUndefined();
  });

  test('shows the system schemas when the connector says so', () => {
    expect(refusal('SELECT * FROM pg_catalog.pg_user', { showSystem: true })).toBeUndefined();
    expect(
      refusal('SELECT * FROM system.query_log', { showSystem: true }, 'clickhouse'),
    ).toBeUndefined();
  });

  test('an except list hides a table however its schema is written', () => {
    const hidden = { names: ['salaries', 'audit.*'] };
    expect(refusal('SELECT * FROM orders JOIN salaries s ON true', hidden)).toContain('"salaries"');
    expect(refusal('SELECT * FROM public.salaries', hidden)).toContain('public.salaries');
    expect(refusal('SELECT * FROM "Salaries"', hidden)).toBeDefined();
    expect(refusal('SELECT * FROM audit.logins', hidden)).toBeDefined();
    expect(refusal('SELECT * FROM orders', hidden)).toBeUndefined();
    expect(refusal('WITH salaries AS (SELECT 1) SELECT * FROM salaries', hidden)).toBeUndefined();
  });

  test('an only list shows a table written as the schema lists it', () => {
    const only: Partial<ObjectVisibility> = { mode: 'only', names: ['orders', 'analytics.*'] };
    expect(refusal('SELECT * FROM orders o JOIN analytics.events e ON true', only)).toBeUndefined();
    expect(refusal('SELECT * FROM public.orders', only)).toBeUndefined();
    expect(refusal('SELECT * FROM customers', only)).toContain('"customers"');
    expect(refusal('SELECT * FROM billing.orders', only)).toContain('billing.orders');
    expect(refusal('SELECT * FROM shop.orders', only, 'mysql')).toContain('shop.orders');
    expect(refusal('SELECT * FROM generate_series(1, 3)', only)).toBeUndefined();
  });

  test('refuses the functions that read a table by name, and Unicode escapes', () => {
    expect(refusal("SELECT query_to_xml('select * from salaries', true, true, '')")).toContain(
      'query_to_xml()',
    );
    expect(refusal("SELECT * FROM merge(currentDatabase(), '.*')", {}, 'clickhouse')).toContain(
      'merge()',
    );
    expect(refusal('SELECT * FROM U&"\\0073alaries"', { names: ['salaries'] })).toContain(
      'Unicode escapes',
    );
  });

  test('checks nothing when the connector shows everything', () => {
    expect(
      refusal('SELECT * FROM pg_catalog.pg_user, U&"x"', { showSystem: true }),
    ).toBeUndefined();
  });
});

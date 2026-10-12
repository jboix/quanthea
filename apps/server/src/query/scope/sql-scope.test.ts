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

  test('finds a TABLE that starts a query after a set operator or a WITH list', () => {
    expect(tablesOf('SELECT 1 AS a UNION ALL TABLE salaries')).toEqual(['salaries']);
    expect(tablesOf('SELECT 1 EXCEPT DISTINCT TABLE hr.salaries')).toEqual(['hr.salaries']);
    expect(tablesOf('TABLE a INTERSECT TABLE b UNION TABLE c')).toEqual(['a', 'b', 'c']);
    expect(tablesOf('WITH x AS (SELECT 1) TABLE salaries')).toEqual(['salaries']);
    expect(tablesOf('WITH x AS (TABLE a), y (n) AS NOT MATERIALIZED (TABLE b) TABLE x')).toEqual([
      'a',
      'b',
    ]);
    expect(tablesOf('SELECT (SELECT 1) table FROM orders')).toEqual(['orders']);
  });

  test('does not take a column named table for the keyword', () => {
    expect(tablesOf('SELECT DISTINCT table FROM system.parts', 'clickhouse')).toEqual([
      'system.parts',
    ]);
    expect(tablesOf('SELECT * EXCEPT table FROM system.parts', 'clickhouse')).toEqual([
      'system.parts',
    ]);
    expect(tablesOf('SELECT t.table, count() FROM system.parts t', 'clickhouse')).toEqual([
      'system.parts',
    ]);
  });

  test('keeps reading tables after an alias that spells a clause', () => {
    for (const alias of ['format', 'settings', 'qualify', 'prewhere', 'offset', 'window']) {
      expect(tablesOf(`SELECT * FROM orders ${alias}, salaries s`)).toEqual(['orders', 'salaries']);
      expect(tablesOf(`SELECT * FROM orders AS ${alias}, salaries`)).toEqual([
        'orders',
        'salaries',
      ]);
    }
    expect(tablesOf('SELECT * FROM orders format (a, b), salaries')).toEqual([
      'orders',
      'salaries',
    ]);
    expect(tablesOf('SELECT * FROM orders limit, salaries', 'trino')).toEqual([
      'orders',
      'salaries',
    ]);
  });

  test('ends the FROM clause where a clause with commas starts', () => {
    const tails = [
      'WHERE a IN (1, 2) GROUP BY a, b',
      'ORDER BY a, b',
      'PREWHERE x = 1 WHERE y = 2 ORDER BY a, b',
      'QUALIFY row_number() OVER (PARTITION BY a ORDER BY b) = 1 ORDER BY a, b',
      'WINDOW w AS (PARTITION BY a), v AS (ORDER BY b)',
      'LIMIT 1 BY a, b',
      'LIMIT 5 OFFSET 2',
      'FORMAT JSON SETTINGS max_threads = 1, max_rows_to_read = 5',
      'HAVING count(*) > 1 UNION SELECT a, b FROM orders',
    ];
    for (const tail of tails) {
      const tables = tablesOf(`SELECT a, b FROM orders ${tail}`, 'clickhouse');
      expect(new Set(tables)).toEqual(new Set(['orders']));
    }
    expect(tablesOf('SELECT * FROM orders LIMIT 1, 2', 'mysql')).toEqual(['orders']);
  });

  test('reads a name that starts with a digit or a dollar in MySQL and MariaDB', () => {
    expect(tablesOf('SELECT * FROM 2fa_secrets', 'mysql')).toEqual(['2fa_secrets']);
    expect(tablesOf('SELECT * FROM shop.2fa_secrets s, 3d', 'mysql')).toEqual([
      'shop.2fa_secrets',
      '3d',
    ]);
    expect(tablesOf('SELECT * FROM $secrets', 'mysql')).toEqual(['$secrets']);
    expect(tablesOf('SELECT 1e5FROM salaries', 'mysql')).toEqual(['salaries']);
    expect(tablesOf('SELECT 1.5 + 2e3 FROM orders WHERE x = 1e5', 'mysql')).toEqual(['orders']);
  });

  test('reads a keyword that follows a number without a space', () => {
    expect(tablesOf('SELECT 1FROM salaries')).toEqual(['salaries']);
    expect(tablesOf('SELECT 1.5e3FROM salaries, more')).toEqual(['salaries', 'more']);
    expect(tablesOf('SELECT .5FROM salaries WHERE x = $1')).toEqual(['salaries']);
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

  test('a list holds for TABLE, an alias that spells a clause, and a digit-leading name', () => {
    const hidden = { names: ['salaries', '2fa_secrets'] };
    const only: Partial<ObjectVisibility> = { mode: 'only', names: ['orders'] };
    const statements = [
      'SELECT 1 AS a UNION ALL TABLE salaries',
      'WITH x AS (SELECT 1) TABLE salaries',
      'SELECT * FROM orders format, salaries',
      'SELECT * FROM orders AS settings, salaries s',
    ];
    for (const statement of statements) {
      expect(refusal(statement, hidden)).toContain('"salaries"');
      expect(refusal(statement, only)).toContain('"salaries"');
    }
    expect(refusal('SELECT * FROM 2fa_secrets', hidden, 'mysql')).toContain('"2fa_secrets"');
    expect(refusal('SELECT * FROM 2fa_secrets', only, 'mysql')).toContain('"2fa_secrets"');
    expect(refusal('SELECT 1 UNION ALL TABLE pg_catalog.pg_shadow')).toContain('pg_shadow');
    expect(refusal('SELECT * FROM orders format, pg_catalog.pg_shadow')).toContain('pg_shadow');
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

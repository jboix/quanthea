import { describe, expect, test } from 'bun:test';
import { bindSql } from './sql-binder.ts';
import type { SqlFlavor } from './sql-dialects.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Whether the binder refuses a statement, and why.
 *
 * @param statement - The SQL.
 * @param flavor - The dialect.
 * @returns The refusal's message, or `undefined` when the statement binds.
 */
function refusal(statement: string, flavor: SqlFlavor): string | undefined {
  try {
    bindSql(statement, {}, timeRange, flavor);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * Expects every statement to be refused.
 *
 * @param flavor - The dialect.
 * @param statements - The statements.
 */
function expectAllRefused(flavor: SqlFlavor, statements: readonly string[]): void {
  for (const statement of statements) expect(refusal(statement, flavor), statement).toBeDefined();
}

describe('one read statement in PostgreSQL', () => {
  test('refuses what writes or reads files inside a read', () => {
    expectAllRefused('postgres', [
      "COPY orders TO '/tmp/orders'",
      "COPY (SELECT 1) TO PROGRAM 'sh'",
      "WITH c AS (COPY orders TO '/tmp/orders') SELECT 1",
      'WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d',
      'WITH u AS (UPDATE orders SET total = 0 RETURNING *) SELECT * FROM u',
      'WITH i AS (INSERT INTO orders DEFAULT VALUES RETURNING *) SELECT * FROM i',
      'WITH m AS (MERGE INTO a USING b ON true WHEN MATCHED THEN DELETE RETURNING *) SELECT 1',
      'SELECT * INTO backup FROM orders',
      'SELECT * FROM orders FOR UPDATE',
      'CALL refresh_orders()',
      'DO $$ BEGIN DELETE FROM orders; END $$',
      'EXPLAIN ANALYZE DELETE FROM orders',
      'SET statement_timeout = 0',
      'PREPARE p AS DELETE FROM orders',
      'EXECUTE p',
      'LOCK TABLE orders',
      'REFRESH MATERIALIZED VIEW daily',
      "NOTIFY orders, 'x'",
    ]);
  });

  test('sees a second statement wherever a literal seems to hide it', () => {
    expectAllRefused('postgres', [
      'SELECT 1; DROP TABLE orders',
      "SELECT ';' ; DROP TABLE orders",
      "SELECT 'a'';' ; DROP TABLE orders",
      "SELECT '\\' ; DROP TABLE orders --'",
      "SELECT E'\\';' ; DROP TABLE orders --'",
      'SELECT "a"";" ; DROP TABLE orders',
      'SELECT $$ ; $$ ; DROP TABLE orders',
      'SELECT $a$ $$ ; $a$ ; DROP TABLE orders',
      'SELECT 1 /* ; */ ; DROP TABLE orders',
      'SELECT 1 /* /* */ */ ; DROP TABLE orders',
      'SELECT 1 -- ;\n; DROP TABLE orders',
      'SELECT a$$ ; DROP TABLE orders; SELECT $$b',
    ]);
  });

  test('reads a literal as the server does when strings are standard', () => {
    const hidden =
      "SELECT '\\' || ') AS q; COMMIT; DROP TABLE orders; BEGIN; SELECT * FROM (SELECT 1 --'";
    // One statement only where a backslash is a plain character: the connector sets it so.
    expect(refusal(hidden, 'postgres')).toBeUndefined();
    expect(refusal('SELECT 1 /* /* */ ; DROP TABLE orders */', 'postgres')).toBeUndefined();
    expect(refusal('SELECT $a$ ; DROP TABLE orders $b$ ; $a$', 'postgres')).toBeUndefined();
  });
});

describe('one read statement in MySQL', () => {
  test('refuses what writes, reads files or runs hidden code', () => {
    expectAllRefused('mysql', [
      "LOAD DATA INFILE '/etc/passwd' INTO TABLE t",
      'CALL refresh_orders()',
      'DO SLEEP(1)',
      'HANDLER orders OPEN',
      'SELECT * FROM orders FOR UPDATE',
      'SELECT 1; DROP TABLE orders',
      'SELECT 1 /*!50000 ; DROP TABLE orders */',
      'SELECT 1 /*M!100000 ; DROP TABLE orders */',
      'SELECT 1 /* /* */ ; DROP TABLE orders */',
      "SELECT 'a\\\\' ; DROP TABLE orders -- '",
      'SELECT 1 # ;\n; DROP TABLE orders',
      'SELECT 1 --; DROP TABLE orders\n; DROP TABLE orders',
      'SELECT `a``;` ; DROP TABLE orders',
    ]);
  });

  test('reads a backslash in a string as the pinned session does', () => {
    expect(refusal('SELECT "a\\"; DROP TABLE orders; -- "', 'mysql')).toBeUndefined();
    expect(refusal("SELECT 'a\\'; DROP TABLE orders; -- '", 'mysql')).toBeUndefined();
  });
});

describe('one read statement in ClickHouse', () => {
  test('refuses what writes, changes settings or the server', () => {
    expectAllRefused('clickhouse', [
      "INSERT INTO FUNCTION file('x.csv') SELECT 1",
      "SELECT 1 INTO OUTFILE '/tmp/x'",
      'SELECT 1 SETTINGS readonly = 0',
      'SYSTEM SHUTDOWN',
      'KILL QUERY WHERE 1',
      'OPTIMIZE TABLE orders',
      'SET readonly = 0',
      'SELECT 1; DROP TABLE orders',
      'SELECT $$ ; $$ ; DROP TABLE orders',
      'SELECT `a\\`` ; DROP TABLE orders',
      'SELECT 1 /* /* */ */ ; DROP TABLE orders',
    ]);
  });
});

describe('one read statement in Trino', () => {
  test('refuses what writes, calls or changes the session', () => {
    expectAllRefused('trino', [
      "CALL system.runtime.kill_query('q', 'x')",
      "EXECUTE IMMEDIATE 'DROP TABLE orders'",
      'PREPARE p FROM DELETE FROM orders',
      'START TRANSACTION READ WRITE',
      'COMMIT',
      "SET SESSION query_max_execution_time = '10d'",
      'USE other.schema',
      'EXPLAIN ANALYZE INSERT INTO orders VALUES (1)',
      'SELECT 1; DROP TABLE orders',
      "SELECT 'a\\' ; DROP TABLE orders --'",
      'SELECT 1 /* /* */ ; DROP TABLE orders */',
    ]);
  });
});

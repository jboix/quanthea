import { describe, expect, test } from 'bun:test';
import { bindSql } from './sql-binder.ts';
import type { SqlFlavor } from './sql-dialects.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a template without variables.
 *
 * @param template - The SQL.
 * @param flavor - The dialect.
 * @returns The bound query.
 */
function bind(template: string, flavor: SqlFlavor) {
  return bindSql(template, {}, timeRange, flavor);
}

/**
 * Expects each statement to be refused for a function it calls.
 *
 * @param flavor - The dialect.
 * @param statements - The statements.
 */
function expectRefused(flavor: SqlFlavor, statements: readonly string[]): void {
  for (const statement of statements) {
    expect(() => bind(statement, flavor), statement).toThrow(/cannot call|Unicode escapes/);
  }
}

describe('what one PostgreSQL read statement cannot reach', () => {
  test("the server's files", () => {
    expectRefused('postgres', [
      "SELECT pg_read_file('/etc/passwd')",
      "SELECT pg_read_binary_file('/etc/passwd')",
      "SELECT * FROM pg_ls_dir('/')",
      'SELECT * FROM pg_ls_logdir()',
      "SELECT (pg_stat_file('/etc/passwd')).size",
      "SELECT lo_import('/etc/passwd')",
      "SELECT lo_export(16400, '/tmp/out')",
      "SELECT pg_file_write('/tmp/x', 'y', false)",
    ]);
  });

  test('another server, text run as SQL, and the server itself', () => {
    expectRefused('postgres', [
      "SELECT * FROM dblink('host=other', 'SELECT 1') AS t(a int)",
      "SELECT dblink_exec('host=other', 'DROP TABLE orders')",
      "SELECT query_to_xml('SELECT * FROM secrets', true, false, '')",
      "SELECT * FROM ts_stat('SELECT secret::tsvector FROM secrets')",
      "SELECT * FROM crosstab('SELECT 1, 2, 3') AS t(a int, b int)",
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity',
      'SELECT pg_reload_conf()',
      "SELECT pg_create_physical_replication_slot('s')",
      "SELECT * FROM pg_logical_slot_get_changes('s', NULL, NULL)",
      'SELECT pg_advisory_lock(1)',
      "SELECT set_config('statement_timeout', '0', false)",
    ]);
  });

  test('however the name is written', () => {
    expectRefused('postgres', [
      "SELECT PG_READ_FILE('/etc/passwd')",
      "SELECT pg_catalog.pg_read_file('/etc/passwd')",
      'SELECT "pg_read_file"(\'/etc/passwd\')',
      "SELECT pg_read_file /* a comment */ ('/etc/passwd')",
      "SELECT pg_read_file\n-- a comment\n('/etc/passwd')",
      'SELECT U&"pg\\005Fread\\005Ffile"(\'/etc/passwd\')',
      "SELECT U&\"pg!005Fread_file\" UESCAPE '!' ('/etc/passwd')",
      "SELECT u&\"set!005Fconfig\" uescape '!'('statement_timeout', '0', false)",
      "SELECT x FROM (SELECT pg_read_file('/etc/passwd') AS x) AS t",
      "WITH t AS (SELECT lo_import('/etc/passwd')) SELECT * FROM t",
    ]);
  });

  test('a name in a string, a column of that name and other functions pass', () => {
    expect(bind("SELECT 'pg_read_file(1)' AS note", 'postgres').text).toContain('note');
    expect(bind('SELECT set_config FROM notes', 'postgres').text).toContain('notes');
    expect(bind('SELECT pg_advisory_xact_lock_shared(1)', 'postgres').text).toContain('xact');
    expect(bind("SELECT current_setting('server_version')", 'postgres').text).toContain('server');
    expect(
      bind('SELECT pg_size_pretty(pg_relation_size(c.oid)) FROM pg_class c', 'postgres').text,
    ).toContain('pg_class');
  });
});

describe('what one MySQL read statement cannot reach', () => {
  test("the server's files, a program and a lock that stays", () => {
    expectRefused('mysql', [
      "SELECT LOAD_FILE('/etc/passwd')",
      "SELECT load_file ('/etc/passwd')",
      "SELECT `load_file`('/etc/passwd')",
      "SELECT load_file/**/('/etc/passwd')",
      "SELECT sys_exec('id')",
      "SELECT sys_eval('id')",
      "SELECT GET_LOCK('orders', 3600)",
    ]);
  });

  test('a file written by INTO is refused as a write', () => {
    for (const statement of [
      "SELECT * FROM orders INTO OUTFILE '/tmp/orders'",
      "SELECT * FROM orders INTO DUMPFILE '/tmp/orders'",
      'SELECT id FROM orders LIMIT 1 INTO @a',
    ]) {
      expect(() => bind(statement, 'mysql'), statement).toThrow(/"INTO" is not allowed/);
    }
  });

  test('other functions pass', () => {
    expect(bind('SELECT SLEEP(0), RELEASE_LOCK(1), load_file FROM t', 'mysql').text).toContain('t');
  });
});

describe('what one ClickHouse read statement cannot reach', () => {
  test('files, object storage, other servers and programs', () => {
    expectRefused('clickhouse', [
      "SELECT * FROM url('http://169.254.169.254/latest/meta-data', 'RawBLOB')",
      "SELECT * FROM file('/etc/passwd', 'LineAsString')",
      "SELECT file('secrets.txt')",
      "SELECT * FROM remote('other:9000', system.one)",
      "SELECT * FROM remoteSecure('other:9440', db.t, 'u', 'p')",
      "SELECT * FROM cluster('all', system.one)",
      "SELECT * FROM s3('https://bucket/key', 'CSV')",
      "SELECT * FROM s3Cluster('all', 'https://bucket/key', 'CSV')",
      "SELECT * FROM azureBlobStorage('conn', 'c', 'b')",
      "SELECT * FROM hdfs('hdfs://nn/x', 'CSV', 'a String')",
      "SELECT * FROM icebergS3('https://bucket/table')",
      "SELECT * FROM deltaLake('https://bucket/table')",
      "SELECT * FROM mysql('db:3306', 'd', 't', 'u', 'p')",
      "SELECT * FROM postgresql('db:5432', 'd', 't', 'u', 'p')",
      "SELECT * FROM mongodb('db:27017', 'd', 'c', 'u', 'p', 'a String')",
      "SELECT * FROM jdbc('ds', 'SELECT 1')",
      "SELECT * FROM executable('script.sh', 'TSV', 'a String')",
      "SELECT * FROM `url`('http://other/', 'RawBLOB')",
      'SELECT * FROM "file"(\'/etc/passwd\')',
    ]);
  });

  test('a file written by INTO OUTFILE is refused as a write', () => {
    expect(() => bind("SELECT 1 INTO OUTFILE '/tmp/x'", 'clickhouse')).toThrow(/"INTO"/);
  });

  test('the functions about URLs, and tables of those names, pass', () => {
    const text = bind(
      'SELECT domain(url), URLHierarchy(url), cluster, file FROM hits WHERE url IN (SELECT url FROM s3)',
      'clickhouse',
    ).text;
    expect(text).toContain('URLHierarchy');
  });
});

describe('what one Trino read statement cannot reach', () => {
  test('text sent to the source under a catalog', () => {
    expectRefused('trino', [
      "SELECT * FROM TABLE(pg.system.query(query => 'WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d'))",
      "SELECT * FROM TABLE(es.system.raw_query(schema => 'default', index => 'logs', query => '{}'))",
      "SELECT * FROM TABLE(mssql.system.procedure(query => 'EXEC drop_everything'))",
      'SELECT * FROM TABLE("pg"."system"."query"(query => \'SELECT 1\'))',
      "SELECT * FROM TABLE(query(query => 'SELECT 1'))",
      'SELECT * FROM TABLE(pg.system.U&"qu\\0065ry"(query => \'SELECT 1\'))',
    ]);
  });

  test('a CALL is no read statement', () => {
    expect(() => bind("CALL system.runtime.kill_query('q', 'x')", 'trino')).toThrow(/starts with/);
  });

  test('a WITH query named query passes', () => {
    const text = bind('WITH query (a) AS (SELECT 1) SELECT a FROM query', 'trino').text;
    expect(text).toContain('FROM query');
  });
});

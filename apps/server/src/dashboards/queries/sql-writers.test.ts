import { describe, expect, test } from 'bun:test';
import { bindSql } from '../../query/sql-binder.ts';
import { buildData } from './build.ts';
import type { BuildContext } from './built.ts';
import { dataSchema } from './request.ts';
import { savedData } from './saved.ts';

/** Every connector runs MySQL. */
const mysql: BuildContext = { saved: [], dialectOf: () => 'mysql' };

/**
 * The SQL a builder writes for a MySQL connector.
 *
 * @param data - The data request.
 * @returns The SQL.
 */
function mysqlOf(data: Record<string, unknown>): string {
  const query = buildData(dataSchema.parse({ connector: 'shop', ...data }), mysql).queries[0];
  return query?.language === 'sql' ? query.sql : '';
}

describe('the SQL builders for MySQL', () => {
  test('bucket time from epoch seconds, cast to CHAR, and quote names in backticks', () => {
    expect(
      mysqlOf({
        kind: 'sql-series',
        table: 'orders',
        time: 'created_at',
        bucket: '5m',
        by: 'status',
        measure: { fn: 'sum', column: 'total_cents' },
        filters: [{ field: 'service', op: '=~', value: '^check' }],
      }),
    ).toBe(
      "SELECT FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(`created_at`) / 300) * 300) AS time, CAST(`status` AS CHAR) AS series, sum(`total_cents`) AS value FROM `orders` WHERE `created_at` BETWEEN :__from AND :__to AND `service` REGEXP '^check' GROUP BY 1, 2 ORDER BY 1",
    );
  });

  test('compute the seconds of an interval variable from its bound value', () => {
    const sql = mysqlOf({
      kind: 'sql-series',
      table: 'shop.orders',
      time: 'created_at',
      bucket: '$interval',
    });
    expect(sql).toContain('FROM `shop`.`orders`');
    const bound = bindSql(sql, { interval: { value: '5m', duration: true } }, range(), 'mysql');
    expect(bound.parameters.filter((value) => value === '5m')).toHaveLength(6);
  });

  test('escape backslashes as well as quotes, so a value cannot close its string', () => {
    const sql = mysqlOf({
      kind: 'sql-stat',
      table: 'orders',
      filters: [{ field: 'note', value: "\\' OR 1=1 -- " }],
    });
    expect(sql).toContain("`note` = '\\\\'' OR 1=1 -- '");
    expect(() => bindSql(sql, {}, range(), 'mysql')).not.toThrow();
  });

  test('write a saved query placeholder for the connector dialect', () => {
    const saved = {
      id: 'by-table',
      name: 'By table',
      description: 'Rows of a table.',
      language: 'sql' as const,
      query: 'SELECT {{column}} FROM {{table}} WHERE t > NOW() - {{window}}',
      params: [
        { name: 'column', kind: 'column' as const, description: 'A column.' },
        { name: 'table', kind: 'table' as const, description: 'A table.' },
        { name: 'window', kind: 'duration' as const, description: 'How far back.' },
      ],
      shape: 'rows' as const,
    };
    const built = savedData(
      {
        kind: 'saved',
        name: 'by-table',
        connector: 'shop',
        params: { column: 'status', table: 'orders', window: '1h' },
      },
      { ...mysql, saved: [saved] },
    );
    expect(built.queries[0]?.language === 'sql' && built.queries[0].sql).toBe(
      'SELECT `status` FROM `orders` WHERE t > NOW() - INTERVAL 3600 SECOND',
    );
  });
});

/**
 * A fixed time range.
 *
 * @returns The range.
 */
function range() {
  return { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };
}

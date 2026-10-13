import { describe, expect, test } from 'bun:test';
import { fixedStepOf } from './fixed-step.ts';

/**
 * A SQL query.
 *
 * @param sql - Its text.
 * @returns The template.
 */
const sql = (sql: string) => ({ connector: 'db', language: 'sql' as const, sql });

/**
 * A search query with one date histogram.
 *
 * @param width - The histogram's width, as written.
 * @returns The template.
 */
const search = (width: unknown) => ({
  connector: 'logs',
  language: 'search' as const,
  index: 'logs-*',
  body: { aggs: { time: { date_histogram: { field: '@timestamp', fixed_interval: width } } } },
});

/**
 * A MongoDB query grouped by a truncated date.
 *
 * @param truncate - The `$dateTrunc` arguments besides the date.
 * @returns The template.
 */
const mongodb = (truncate: Record<string, unknown>) => ({
  connector: 'mongo',
  language: 'mongodb' as const,
  collection: 'orders',
  pipeline: [{ $group: { _id: { $dateTrunc: { date: '$created_at', ...truncate } } } }],
});

describe('a query that cuts time by a step of its own', () => {
  test('is SQL that truncates or bins time by a literal width, in any dialect', () => {
    const fixed = [
      "SELECT date_trunc('minute', created_at) AS time, count(*) FROM orders GROUP BY 1",
      "SELECT date_bin('5m'::interval, created_at, :__from) AS time FROM orders",
      "SELECT time_bucket(INTERVAL '1 minute', ts) AS time FROM metrics",
      'SELECT toStartOfMinute(ts) AS time FROM hits',
      'SELECT FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(`created_at`) / 300) * 300) AS time FROM orders',
      "SELECT toDateTime(intDiv(toUnixTimestamp(`ts`), 300) * 300, 'UTC') AS time FROM hits",
    ];
    for (const text of fixed) expect(fixedStepOf(sql(text))).toContain(':__interval');
  });

  test('is SQL in the other spellings of a literal width', () => {
    const fixed = [
      'SELECT floor(extract(epoch from t) / 300) * 300 AS time, count(*) FROM o GROUP BY 1',
      'SELECT DATE_TRUNC($$hour$$, t) AS time, count(*) FROM o GROUP BY 1',
      'SELECT toStartOfInterval(t, toIntervalMinute(5)) AS time FROM hits',
      "SELECT count(*) FROM o WHERE x = 1 GROUP BY date_trunc('hour', t)",
    ];
    for (const text of fixed) expect(fixedStepOf(sql(text)), text).toContain(':__interval');
  });

  test('is still one when the interval is only named in a comment or a string', () => {
    const commented = "SELECT date_trunc('day', t) AS time FROM o -- :__interval";
    expect(fixedStepOf(sql(commented))).toContain(':__interval');
    const quoted = "SELECT date_trunc('day', t) AS time, ':__interval' AS note FROM o";
    expect(fixedStepOf(sql(quoted))).toContain(':__interval');
  });

  test('is not SQL that truncates time only to bound its rows', () => {
    const bounded = [
      "SELECT count(*) AS value FROM o WHERE created_at >= date_trunc('hour', :__to::timestamptz)",
      "SELECT count(*) AS value FROM o WHERE a = 1 AND created_at >= date_trunc('day', :__to)",
      "SELECT count(*) FILTER (WHERE t >= date_trunc('day', now())) AS today FROM o",
      "SELECT sum(n) FROM o JOIN d ON d.day = date_trunc('day', o.t) HAVING max(t) > toStartOfDay(now())",
      "SELECT 'date_trunc(''hour'', t)' AS note FROM o /* toStartOfHour(t) */",
    ];
    for (const text of bounded) expect(fixedStepOf(sql(text)), text).toBeUndefined();
  });

  test('is not SQL that bins by the interval, by a variable, or not at all', () => {
    const follows = 'SELECT date_bin(:__interval::interval, created_at, :__from) AS time FROM o';
    expect(fixedStepOf(sql(follows))).toBeUndefined();
    expect(
      fixedStepOf(sql('SELECT date_bin(:width::interval, t, :__from) FROM o')),
    ).toBeUndefined();
    expect(fixedStepOf(sql('SELECT day AS time, total FROM daily_sales'))).toBeUndefined();
  });

  test('is a search histogram of a written width, not one of the interval', () => {
    expect(fixedStepOf(search('1m'))).toContain('"fixed_interval": {"$var": "__interval"}');
    expect(fixedStepOf(search({ $var: '__interval' }))).toBeUndefined();
    expect(fixedStepOf(search({ $var: 'interval' }))).toBeUndefined();
  });

  test('is a MongoDB $dateTrunc without a bound bin size', () => {
    expect(fixedStepOf(mongodb({ unit: 'minute' }))).toContain('__interval_ms');
    expect(fixedStepOf(mongodb({ unit: 'minute', binSize: 5 }))).toContain('__interval_ms');
    const bound = { unit: 'millisecond', binSize: { $var: '__interval_ms' } };
    expect(fixedStepOf(mongodb(bound))).toBeUndefined();
    const variable = { unit: 'millisecond', binSize: { $var: 'interval', as: 'ms' } };
    expect(fixedStepOf(mongodb(variable))).toBeUndefined();
  });

  test('is a PromQL or LogQL range query with a step written out', () => {
    const promql = { connector: 'prom', language: 'promql' as const, expr: 'up' };
    expect(fixedStepOf({ ...promql, step: '15s' })).toContain('leave "step" out');
    expect(fixedStepOf(promql)).toBeUndefined();
    expect(fixedStepOf({ ...promql, step: '$interval' })).toBeUndefined();
    expect(fixedStepOf({ ...promql, step: '15s', instant: true })).toBeUndefined();
  });
});

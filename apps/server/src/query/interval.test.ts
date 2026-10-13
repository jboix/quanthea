import { describe, expect, test } from 'bun:test';
import { bindTemplate } from './bind.ts';
import { chosenSeconds, sqlInterval } from './interval.ts';

const hour = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };
const week = { from: new Date('2026-09-21T00:00:00Z'), to: new Date('2026-09-28T00:00:00Z') };

const bucketSql =
  'SELECT date_bin(:__interval::interval, created_at, :__from) AS time, count(*) AS orders ' +
  'FROM orders WHERE created_at BETWEEN :__from AND :__to GROUP BY 1';

describe('a chosen interval', () => {
  test('is a duration above zero, checked before anything is bound', () => {
    expect(chosenSeconds(undefined)).toBeUndefined();
    expect(chosenSeconds('10m')).toBe(600);
    expect(() => chosenSeconds('0m')).toThrow('duration');
    expect(() => chosenSeconds("1h'; DROP")).toThrow('duration');
  });

  test('is the step of a PromQL query, and its $__interval', () => {
    const template = { language: 'promql' as const, expr: 'rate(up[$__interval])' };
    const bound = bindTemplate(template, {}, week, { interval: '1h' });
    expect(bound).toMatchObject({ expr: 'rate(up[3600s])', stepSeconds: 3600 });
  });

  test('replaces the step a PromQL query names itself', () => {
    const template = { language: 'promql' as const, expr: 'up', step: '15s' };
    expect(bindTemplate(template, {}, week, { interval: '6h' })).toMatchObject({
      stepSeconds: 21_600,
    });
    expect(bindTemplate(template, {}, hour)).toMatchObject({ stepSeconds: 15 });
  });

  test('is still raised when the range would pass the point limit', () => {
    const template = { language: 'promql' as const, expr: 'up' };
    const bound = bindTemplate(template, {}, week, { interval: '1m', maxPoints: 1000 });
    expect(bound).toMatchObject({ stepSeconds: 605 });
  });

  test('is the step of a LogQL query', () => {
    const template = {
      language: 'logql' as const,
      expr: 'sum(count_over_time({app="x"}[$__interval]))',
    };
    expect(bindTemplate(template, {}, week, { interval: '1d' })).toMatchObject({
      expr: 'sum(count_over_time({app="x"}[86400s]))',
      stepSeconds: 86_400,
    });
  });

  test('is the __interval of a search, in place of the one its range gives', () => {
    const body = { aggs: { t: { date_histogram: { fixed_interval: { $var: '__interval' } } } } };
    const template = { language: 'search' as const, index: 'logs-*', body };
    const width = (interval?: string) =>
      JSON.stringify(bindTemplate(template, {}, week, { interval }));
    expect(width('1h')).toContain('"fixed_interval":"1h"');
    expect(width()).toContain('"fixed_interval":"15m"');
  });

  test('is the __interval_ms of a MongoDB pipeline', () => {
    const pipeline = [{ $set: { width: { $var: '__interval_ms' } } }];
    const template = { language: 'mongodb' as const, collection: 'orders', pipeline };
    expect(bindTemplate(template, {}, week, { interval: '10m' })).toMatchObject({
      pipeline: [{ $set: { width: 600_000 } }],
    });
  });

  test('is the :__interval of a SQL query, bound as a value', () => {
    const template = { language: 'sql' as const, sql: bucketSql };
    const bound = bindTemplate(template, {}, week, { interval: '6h' });
    expect(bound).toMatchObject({
      text: expect.stringContaining('date_bin($1::interval, created_at, $2)'),
      parameters: ['6h', week.from, week.to],
    });
  });
});

describe(':__interval when nobody chose', () => {
  test('follows the length of the time range, from the closed list', () => {
    expect(sqlInterval(hour, undefined)).toBe('1m');
    expect(sqlInterval(week, undefined)).toBe('1h');
  });

  test('comes in seconds too, for the dialects that bucket from epoch seconds', () => {
    const sql = 'SELECT FLOOR(UNIX_TIMESTAMP(at) / :__interval_s) * :__interval_s AS time FROM t';
    const template = { language: 'sql' as const, sql };
    expect(bindTemplate(template, {}, week, { dialect: 'mysql' })).toMatchObject({
      text: 'SELECT FLOOR(UNIX_TIMESTAMP(at) / ?) * ? AS time FROM t',
      parameters: [3600, 3600],
    });
    const chosen = bindTemplate(template, {}, week, { dialect: 'clickhouse', interval: '10m' });
    expect(chosen).toMatchObject({ parameters: [600] });
    expect(chosen).toMatchObject({ text: expect.stringContaining('{p1:Float64}') });
  });

  test('binds in every SQL dialect', () => {
    const template = { language: 'sql' as const, sql: 'SELECT :__interval AS width' };
    for (const dialect of ['postgres', 'mysql', 'clickhouse', 'trino'] as const)
      expect(bindTemplate(template, {}, week, { dialect })).toMatchObject({ parameters: ['1h'] });
  });
});

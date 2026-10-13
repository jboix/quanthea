import { describe, expect, test } from 'bun:test';
import { bindTemplate } from './bind.ts';
import { sqlIntervalWithin } from './interval.ts';

const day = { from: new Date('2026-09-27T00:00:00Z'), to: new Date('2026-09-28T00:00:00Z') };
const week = { from: new Date('2026-09-21T00:00:00Z'), to: new Date('2026-09-28T00:00:00Z') };
const year = { from: new Date('2025-09-28T00:00:00Z'), to: new Date('2026-09-28T00:00:00Z') };

describe('the points a chart can show, in PromQL and LogQL', () => {
  const up = { language: 'promql' as const, expr: 'rate(up[$__rate_interval])' };

  test('raise the step until the range has no more points', () => {
    expect(bindTemplate(up, {}, day)).toMatchObject({ stepSeconds: 15 });
    expect(bindTemplate(up, {}, day, { chartPoints: 1200 })).toMatchObject({
      stepSeconds: 72,
      expr: 'rate(up[288s])',
    });
    expect(bindTemplate(up, {}, day, { chartPoints: 2400 })).toMatchObject({ stepSeconds: 36 });
  });

  test('raise the step a query names itself, which is the smallest it accepts', () => {
    const stepped = { ...up, step: '1m' };
    expect(bindTemplate(stepped, {}, day, { chartPoints: 2400 })).toMatchObject({
      stepSeconds: 60,
    });
    expect(bindTemplate(stepped, {}, week, { chartPoints: 2400 })).toMatchObject({
      stepSeconds: 252,
    });
  });

  test('never raise the point limit of the connector', () => {
    const bound = bindTemplate(up, {}, day, { maxPoints: 100, chartPoints: 1200 });
    expect(bound).toMatchObject({ stepSeconds: 864 });
  });

  test('leave a chosen interval as it was chosen', () => {
    const bound = bindTemplate(up, {}, day, { interval: '1m', chartPoints: 200 });
    expect(bound).toMatchObject({ stepSeconds: 60 });
  });

  test('raise the step of a LogQL query the same way', () => {
    const logs = {
      language: 'logql' as const,
      expr: 'sum(count_over_time({app="x"}[$__interval]))',
    };
    expect(bindTemplate(logs, {}, day, { chartPoints: 600 })).toMatchObject({
      stepSeconds: 144,
      expr: 'sum(count_over_time({app="x"}[144s]))',
    });
  });

  test('leave an instant query alone', () => {
    const instant = { language: 'promql' as const, expr: 'up', instant: true };
    expect(bindTemplate(instant, {}, day, { chartPoints: 200 })).toMatchObject({ instant: true });
  });

  test('leave the step of a window written out, which a wider step would read in part', () => {
    const errors = { language: 'promql' as const, expr: 'sum(increase(errors_total[1m]))' };
    const stepped = { ...errors, step: '1m' };
    expect(bindTemplate(stepped, {}, day, { chartPoints: 600 })).toMatchObject({ stepSeconds: 60 });
    expect(bindTemplate(errors, {}, day, { chartPoints: 600 })).toMatchObject({ stepSeconds: 15 });
    expect(bindTemplate({ ...errors, expr: 'up' }, {}, day, { chartPoints: 600 })).toMatchObject({
      stepSeconds: 15,
    });
    const logs = { language: 'logql' as const, expr: 'count_over_time({app="x"}[1m])' };
    expect(bindTemplate(logs, {}, day, { chartPoints: 600 })).toMatchObject({ stepSeconds: 15 });
  });

  test('still raise such a step to the point limit of the connector', () => {
    const errors = { language: 'promql' as const, expr: 'increase(errors_total[1m])' };
    const bound = bindTemplate(errors, {}, day, { maxPoints: 100, chartPoints: 1200 });
    expect(bound).toMatchObject({ stepSeconds: 864 });
  });

  test('read the built-in in the code, not in a string or a comment', () => {
    const named = {
      language: 'promql' as const,
      expr: 'increase(errors_total{note="$__interval"}[1m]) # $__interval',
    };
    expect(() => bindTemplate(named, {}, day, { chartPoints: 600 })).toThrow();
    const commented = { ...named, expr: 'increase(errors_total[1m]) # $__interval' };
    expect(bindTemplate(commented, {}, day, { chartPoints: 600 })).toMatchObject({
      stepSeconds: 15,
    });
  });
});

describe('the points a chart can show, in SQL', () => {
  const sql = 'SELECT date_bin(:__interval::interval, at, :__from) AS time, :__interval_s FROM t';
  const template = { language: 'sql' as const, sql };

  test('keep the interval of the range when it fits', () => {
    expect(sqlIntervalWithin(day, 1200)).toBe('10m');
    expect(sqlIntervalWithin(week, 400)).toBe('1h');
  });

  test('take the next interval of the closed list that fits', () => {
    expect(sqlIntervalWithin(day, 100)).toBe('30m');
    expect(sqlIntervalWithin(week, 100)).toBe('6h');
    expect(sqlIntervalWithin(week, 20)).toBe('1d');
  });

  test('stay at a day, the coarsest of the list, when even that does not fit', () => {
    expect(sqlIntervalWithin(year, 200)).toBe('1d');
  });

  test('bind :__interval and :__interval_s to it', () => {
    expect(bindTemplate(template, {}, week, { chartPoints: 100 })).toMatchObject({
      parameters: ['6h', week.from, 21_600],
    });
    expect(bindTemplate(template, {}, week)).toMatchObject({ parameters: ['1h', week.from, 3600] });
  });

  test('leave a chosen interval as it was chosen', () => {
    const bound = bindTemplate(template, {}, week, { interval: '10m', chartPoints: 200 });
    expect(bound).toMatchObject({ parameters: ['10m', week.from, 600] });
  });

  test('change nothing in a query that cuts time by a width of its own', () => {
    const fixed = {
      language: 'sql' as const,
      sql: "SELECT date_trunc('minute', at) AS time FROM t",
    };
    expect(bindTemplate(fixed, {}, week, { chartPoints: 200 })).toEqual(
      bindTemplate(fixed, {}, week),
    );
  });
});

describe('the points a chart can show, in a search and in MongoDB', () => {
  const body = { aggs: { t: { date_histogram: { fixed_interval: { $var: '__interval' } } } } };
  const search = { language: 'search' as const, index: 'logs-*', body };
  const pipeline = [{ $set: { width: { $var: '__interval_ms' } } }];
  const mongodb = { language: 'mongodb' as const, collection: 'orders', pipeline };

  test('widen the buckets of a search until the range has no more', () => {
    const width = (chartPoints?: number) =>
      JSON.stringify(bindTemplate(search, {}, week, { chartPoints }));
    expect(width()).toContain('"fixed_interval":"15m"');
    expect(width(2400)).toContain('"fixed_interval":"15m"');
    expect(width(600)).toContain('"fixed_interval":"30m"');
    expect(width(200)).toContain('"fixed_interval":"1h"');
  });

  test('widen the buckets of a MongoDB pipeline the same way', () => {
    expect(bindTemplate(mongodb, {}, week)).toMatchObject({
      pipeline: [{ $set: { width: 900_000 } }],
    });
    expect(bindTemplate(mongodb, {}, week, { chartPoints: 200 })).toMatchObject({
      pipeline: [{ $set: { width: 3_600_000 } }],
    });
  });

  test('leave a chosen interval as it was chosen', () => {
    const bound = bindTemplate(search, {}, week, { interval: '5m', chartPoints: 200 });
    expect(JSON.stringify(bound)).toContain('"fixed_interval":"5m"');
  });
});

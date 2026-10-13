import { describe, expect, test } from 'bun:test';
import {
  chartIntervalChoices,
  chartIntervalSchema,
  defaultChartInterval,
  fitsPeriod,
  followsChartInterval,
} from './chart-interval.ts';

const hour = 3_600_000;
const day = 24 * hour;

describe('the interval a period takes when nobody chose', () => {
  test('a day is cut by 10 minutes, a week by the hour, a month by the day', () => {
    expect(defaultChartInterval(day)).toBe('10m');
    expect(defaultChartInterval(7 * day)).toBe('1h');
    expect(defaultChartInterval(28 * day)).toBe('1d');
    expect(defaultChartInterval(31 * day)).toBe('1d');
  });

  test('short periods are cut finer, and a day with a changed clock stays by 10 minutes', () => {
    expect(defaultChartInterval(10 * 60_000)).toBe('1m');
    expect(defaultChartInterval(6 * hour)).toBe('5m');
    expect(defaultChartInterval(25 * hour)).toBe('10m');
    expect(defaultChartInterval(3 * day)).toBe('30m');
    expect(defaultChartInterval(20 * day)).toBe('6h');
  });
});

describe('the intervals a person may choose', () => {
  test('a day offers every interval that leaves at least two pieces', () => {
    expect(chartIntervalChoices(day)).toEqual(['1m', '5m', '10m', '30m', '1h', '6h']);
  });

  test('a month leaves out the intervals that would cut it too fine', () => {
    expect(chartIntervalChoices(31 * day)).toEqual(['30m', '1h', '6h', '1d']);
  });

  test('nothing finer than the data comes is offered', () => {
    expect(chartIntervalChoices(day, 15 * 60_000)).toEqual(['30m', '1h', '6h']);
  });

  test('an interval is checked against the period', () => {
    expect(fitsPeriod('1m', 7 * day)).toBe(false);
    expect(fitsPeriod('1h', 7 * day)).toBe(true);
  });

  test('the list is closed', () => {
    expect(chartIntervalSchema.safeParse('2m').success).toBe(false);
    expect(chartIntervalSchema.safeParse('10m').success).toBe(true);
  });
});

describe('a query that follows the interval', () => {
  const sql = (text: string) => ({ connector: 'db', language: 'sql' as const, sql: text });

  test('is a PromQL or LogQL range query, whatever its step', () => {
    const promql = { connector: 'prom', language: 'promql' as const, expr: 'up' };
    expect(followsChartInterval(promql)).toBe(true);
    expect(followsChartInterval({ ...promql, instant: true })).toBe(false);
  });

  test('is a query that names the interval built-in of its language', () => {
    expect(followsChartInterval(sql('SELECT :__interval AS width'))).toBe(true);
    expect(followsChartInterval(sql('SELECT :__interval_s AS seconds'))).toBe(true);
    expect(followsChartInterval(sql("SELECT date_trunc('hour', t) FROM o"))).toBe(false);
    const histogram = { date_histogram: { fixed_interval: { $var: '__interval' } } };
    const search = { connector: 'logs', language: 'search' as const, index: 'logs-*' };
    expect(followsChartInterval({ ...search, body: { aggs: { time: histogram } } })).toBe(true);
    expect(followsChartInterval({ ...search, body: { size: 0 } })).toBe(false);
  });

  test('is not one whose connector only is named like the built-in', () => {
    expect(followsChartInterval({ ...sql('SELECT 1 AS one'), connector: 'db__interval' })).toBe(
      false,
    );
  });
});

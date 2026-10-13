import { describe, expect, test } from 'bun:test';
import { bindSearch } from './search-binder.ts';

const week = {
  from: new Date('2026-10-06T11:08:07.971Z'),
  to: new Date('2026-10-13T11:08:07.971Z'),
};
const bounds = { min: week.from.getTime(), max: week.to.getTime() - 1 };
const inPeriod = { range: { '@timestamp': { gte: { $var: '__from' }, lte: { $var: '__to' } } } };

/**
 * Binds a search of `@timestamp` over the week and gives back one of its aggregations.
 *
 * @param aggs - The aggregations.
 * @param query - The query; the time range on `@timestamp` when not given.
 * @param name - The aggregation to give back.
 * @returns The aggregation's body, bound.
 */
function bound(aggs: Record<string, unknown>, query: unknown = inPeriod, name = 'time') {
  const template = { index: 'logs-*', body: { size: 0, query, aggs } };
  const body = bindSearch(template, {}, week).body as { aggs: Record<string, unknown> };
  return body.aggs[name] as Record<string, Record<string, unknown>>;
}

/**
 * A date histogram of `@timestamp` by the built-in interval, with more settings.
 *
 * @param more - The settings to add.
 * @returns The aggregation.
 */
function histogram(more: Record<string, unknown> = {}) {
  return {
    date_histogram: { field: '@timestamp', fixed_interval: { $var: '__interval' }, ...more },
  };
}

describe('a date histogram over the time range', () => {
  test('keeps its empty buckets and takes the range as bounds, in epoch milliseconds', () => {
    expect(bound({ time: histogram() }).date_histogram).toEqual({
      field: '@timestamp',
      fixed_interval: '15m',
      min_doc_count: 0,
      extended_bounds: bounds,
    });
    expect(bound({ time: histogram({ min_doc_count: 0 }) }).date_histogram).toMatchObject({
      extended_bounds: bounds,
    });
  });

  test('keeps the sub-aggregations it has', () => {
    const series = { terms: { field: 'level', size: 5 } };
    const time = bound({ time: { ...histogram(), aggs: { series } } });
    expect(time.aggs).toEqual({ series });
    expect(time.date_histogram).toMatchObject({ min_doc_count: 0, extended_bounds: bounds });
  });

  test('is filled under an aggregation with one bucket', () => {
    const errors = { filter: { term: { level: 'error' } }, aggs: { time: histogram() } };
    const inner = bound({ errors }, inPeriod, 'errors').aggs as Record<string, unknown>;
    expect(inner.time).toMatchObject({ date_histogram: { extended_bounds: bounds } });
  });

  test('is filled with a calendar interval', () => {
    const daily = { date_histogram: { field: '@timestamp', calendar_interval: 'day' } };
    expect(bound({ time: daily }).date_histogram).toMatchObject({ extended_bounds: bounds });
  });
});

describe('a date histogram the query decided', () => {
  test('keeps the min_doc_count it sets above 0', () => {
    const written = bound({ time: histogram({ min_doc_count: 1 }) }).date_histogram;
    expect(written).toEqual({ field: '@timestamp', fixed_interval: '15m', min_doc_count: 1 });
  });

  test('keeps the bounds it sets, read as ISO text when it binds the range', () => {
    const own = { min: { $var: '__from' }, max: { $var: '__to' } };
    const extended = bound({ time: histogram({ extended_bounds: own }) }).date_histogram;
    expect(extended).toEqual({
      field: '@timestamp',
      fixed_interval: '15m',
      extended_bounds: { min: week.from.toISOString(), max: week.to.toISOString() },
      format: 'strict_date_optional_time||epoch_millis',
    });
    const hard = bound({ time: histogram({ hard_bounds: { min: 1, max: 2 } }) }).date_histogram;
    expect(hard).toEqual({
      field: '@timestamp',
      fixed_interval: '15m',
      hard_bounds: { min: 1, max: 2 },
    });
  });

  test('keeps the format it names beside its bounds', () => {
    const own = { extended_bounds: { min: { $var: '__from' } }, format: 'epoch_millis' };
    expect(bound({ time: histogram(own) }).date_histogram?.format).toBe('epoch_millis');
  });
});

describe('a date histogram that is not filled', () => {
  test('one over a field the time range does not filter', () => {
    const created = { date_histogram: { field: 'created_at', fixed_interval: '1h' } };
    expect(bound({ time: created }).date_histogram).toEqual(created.date_histogram);
  });

  test('one of a query that does not follow the time range', () => {
    const fixed = { range: { '@timestamp': { gte: '2026-10-01', lte: '2026-10-02' } } };
    const written = bound({ time: histogram() }, fixed).date_histogram;
    expect(written).toEqual({ field: '@timestamp', fixed_interval: '15m' });
  });

  test('one under a terms, which would have its buckets for every term', () => {
    const service = { terms: { field: 'service' }, aggs: { time: histogram() } };
    const inner = bound({ service }, inPeriod, 'service').aggs as Record<string, unknown>;
    expect(inner.time).toEqual({ date_histogram: { field: '@timestamp', fixed_interval: '15m' } });
  });

  test('one whose own width would cut the range into more buckets than a chart has', () => {
    const fine = { date_histogram: { field: '@timestamp', fixed_interval: '1m' } };
    expect(bound({ time: fine }).date_histogram).toEqual(fine.date_histogram);
    const unknown = { date_histogram: { field: '@timestamp', interval: '1h' } };
    expect(bound({ time: unknown }).date_histogram).toEqual(unknown.date_histogram);
  });
});

describe('a date histogram of an alert', () => {
  test('keeps only the buckets it has, so a stretch without a document is no data', () => {
    const template = { index: 'logs-*', body: { query: inPeriod, aggs: { time: histogram() } } };
    const { body } = bindSearch(template, {}, week, { sparse: true });
    expect((body.aggs as { time: unknown }).time).toEqual({
      date_histogram: { field: '@timestamp', fixed_interval: '15m' },
    });
  });
});

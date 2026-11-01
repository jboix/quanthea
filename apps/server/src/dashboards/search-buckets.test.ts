import { describe, expect, test } from 'bun:test';
import { bucketProblem, searchBuckets } from './search-buckets.ts';

const hour = 3_600_000;

describe('the buckets of a search', () => {
  test('multiply time buckets by the groups under them, and take the largest of siblings', () => {
    const body = {
      aggs: {
        time: {
          date_histogram: { fixed_interval: '1m' },
          aggs: { pairs: { multi_terms: { size: 20 } } },
        },
      },
    };
    expect(searchBuckets(body, hour)).toBe(60 * 20);
    const named = { aggs: { group: { filters: { filters: { a: {}, b: {}, c: {} } } } } };
    expect(searchBuckets(named, hour)).toBe(3);
    expect(searchBuckets({ aggs: { by: { terms: {} } } }, hour)).toBe(10);
    const calendar = { aggs: { day: { date_histogram: { calendar_interval: 'day' } } } };
    expect(searchBuckets(calendar, 30 * 24 * hour)).toBe(30);
    expect(searchBuckets({ query: {} }, hour)).toBe(1);
  });

  test('say to ask for fewer groups when there is no time to widen', () => {
    const groups = { aggs: { a: { terms: { size: 500 }, aggs: { b: { terms: { size: 500 } } } } } };
    expect(bucketProblem(groups, hour)).toContain('ask for fewer groups.');
  });
});

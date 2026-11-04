import { describe, expect, test } from 'bun:test';
import { builderOfSearch, rawSearchNotes } from './raw-search-notes.ts';

const filters = {
  bool: { filter: [{ term: { bu: 'srf' } }, { range: { '@timestamp': { gte: 'now-1h' } } }] },
};

describe('a raw search a builder writes', () => {
  test('names the builder by its one aggregation', () => {
    const series = {
      size: 0,
      query: filters,
      aggs: {
        t: {
          date_histogram: { field: '@timestamp', fixed_interval: '1m' },
          aggs: { by: { terms: { field: 'type' } } },
        },
      },
    };
    expect(builderOfSearch(series)).toBe('search-series');
    expect(builderOfSearch({ size: 0, aggs: { by: { terms: { field: 'type' } } } })).toBe(
      'search-breakdown',
    );
    const columns = { a: { avg: { field: 'x' } }, b: { max: { field: 'x' } } };
    expect(
      builderOfSearch({ size: 0, aggs: { by: { terms: { field: 'type' }, aggs: columns } } }),
    ).toBe('search-table');
    expect(
      builderOfSearch({ size: 0, aggs: { h: { histogram: { field: 'ms', interval: 100 } } } }),
    ).toBe('search-histogram');
    expect(builderOfSearch({ size: 0, aggs: { n: { cardinality: { field: 'session' } } } })).toBe(
      'search-stat',
    );
    expect(builderOfSearch({ size: 50, sort: [{ '@timestamp': 'desc' }], query: filters })).toBe(
      'search-rows',
    );
  });

  test('names none for what only a raw search sends', () => {
    expect(
      builderOfSearch({ size: 0, runtime_mappings: {}, aggs: { n: { sum: { field: 'x' } } } }),
    ).toBeUndefined();
    expect(builderOfSearch({ query: { script: { script: 'doc.x > 1' } } })).toBeUndefined();
    const ratio = { r: { bucket_script: { buckets_path: {}, script: 'a / b' } } };
    expect(
      builderOfSearch({ size: 0, aggs: { t: { date_histogram: { field: 't' }, aggs: ratio } } }),
    ).toBeUndefined();
    expect(
      builderOfSearch({
        size: 0,
        aggs: { a: { terms: { field: 'x' } }, b: { terms: { field: 'y' } } },
      }),
    ).toBeUndefined();
  });

  test('gives a note on the panels of the edit whose raw search a builder writes', () => {
    const raw = (query: string) => ({
      kind: 'raw',
      connector: 'logs',
      language: 'search',
      index: 'events',
      query,
    });
    const panels = [
      { title: 'Errors by type', data: raw('{"size":0,"aggs":{"by":{"terms":{"field":"type"}}}}') },
      { title: 'Odd', data: raw('{"size":0,"aggs":{"a":{"scripted_metric":{}}}}') },
      { title: 'Broken', data: raw('not json') },
    ];
    expect(rawSearchNotes({ panels } as never)).toEqual([
      '"Errors by type" sends a raw search that the search-breakdown builder writes. Next time build it with { "kind": "search-breakdown" }: the builder checks its fields and its buckets.',
    ]);
  });
});

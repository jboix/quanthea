import { describe, expect, test } from 'bun:test';
import { searchRatioScripts } from '../connectors/_shared/index.ts';
import { bindSearch, searchInterval } from './search-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a search body over the fixed time range.
 *
 * @param body - The body.
 * @param variables - The variable values.
 * @param index - The index.
 * @returns The bound query.
 */
function bind(
  body: Record<string, unknown>,
  variables: Record<string, string | string[]> = {},
  index = 'logs-*',
) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindSearch({ index, body }, bindings, timeRange);
}

describe('bindSearch', () => {
  test('replaces variable nodes with JSON values: a string, a list, and the time range', () => {
    const bound = bind(
      {
        query: {
          bool: {
            filter: [
              { term: { service: { $var: 'service' } } },
              { terms: { level: { $var: 'levels' } } },
              { range: { '@timestamp': { gte: { $var: '__from' }, lte: { $var: '__to' } } } },
            ],
          },
        },
        aggs: {
          t: { date_histogram: { field: '@timestamp', fixed_interval: { $var: '__interval' } } },
        },
      },
      { service: 'checkout', levels: ['error', 'warn'] },
    );
    expect(bound).toEqual({
      language: 'search',
      index: 'logs-*',
      body: {
        query: {
          bool: {
            filter: [
              { term: { service: 'checkout' } },
              { terms: { level: ['error', 'warn'] } },
              {
                range: {
                  '@timestamp': {
                    gte: '2026-09-27T12:00:00.000Z',
                    lte: '2026-09-27T13:00:00.000Z',
                    format: 'strict_date_optional_time||epoch_millis',
                  },
                },
              },
            ],
          },
        },
        aggs: {
          t: {
            date_histogram: {
              field: '@timestamp',
              fixed_interval: '5s',
              min_doc_count: 0,
              extended_bounds: { min: timeRange.from.getTime(), max: timeRange.to.getTime() - 1 },
            },
          },
        },
      },
    });
  });

  test('a range keeps the format it names, and one over another field gets none', () => {
    const bound = bind(
      {
        query: {
          bool: {
            filter: [
              { range: { at: { gte: { $var: '__from' }, format: 'epoch_millis' } } },
              { range: { duration_ms: { gte: 100 } } },
            ],
          },
        },
      },
      {},
    );
    expect(bound.body).toEqual({
      query: {
        bool: {
          filter: [
            { range: { at: { gte: '2026-09-27T12:00:00.000Z', format: 'epoch_millis' } } },
            { range: { duration_ms: { gte: 100 } } },
          ],
        },
      },
    });
  });
  test('a range bounded by ISO text the query writes itself gets the format', () => {
    const written = { gte: '2026-10-05T14:47:01Z', lt: 1_791_000_000_000 };
    const bound = bind({
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': written } },
            { range: { day: { gte: '2026-10-05', lte: '2026-10-06T00:00:00.000+02:00||/d' } } },
          ],
        },
      },
    });
    const format = 'strict_date_optional_time||epoch_millis';
    expect(bound.body).toEqual({
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { ...written, format } } },
            {
              range: {
                day: { gte: '2026-10-05', lte: '2026-10-06T00:00:00.000+02:00||/d', format },
              },
            },
          ],
        },
      },
    });
  });

  test('a range bounded by a variable holding a date gets the format, once it is bound', () => {
    const bound = bind(
      { query: { range: { at: { gte: { $var: 'since' } } } } },
      {
        since: '2026-10-05T14:47:01Z',
      },
    );
    expect(bound.body).toEqual({
      query: {
        range: {
          at: { gte: '2026-10-05T14:47:01Z', format: 'strict_date_optional_time||epoch_millis' },
        },
      },
    });
  });

  test('a range with a text bound in another form beside an ISO one gets no format', () => {
    const body = {
      query: {
        bool: {
          filter: [
            { range: { day: { gte: '2026-10-05', lte: '2026-10-06 23:59:59' } } },
            { range: { at: { gt: '05/10/2026', lt: '2026-10-06T00:00:00Z' } } },
          ],
        },
      },
    };
    expect(bind(body).body).toEqual(body);
  });

  test('a range with an ISO bound beside date math, a number or a time zone gets the format', () => {
    const format = 'strict_date_optional_time||epoch_millis';
    const ranges = [
      { gte: '2026-10-05', lte: 'now-1d/d' },
      { gte: '2026-10-05T00:00:00Z', lt: 1_791_000_000_000 },
      { gte: '2026-10-05', time_zone: '+02:00', relation: 'within' },
    ];
    for (const range of ranges) {
      expect(bind({ query: { range: { at: range } } }).body).toEqual({
        query: { range: { at: { ...range, format } } },
      });
    }
  });

  test('a range bounded by numbers, date math or other text gets no format', () => {
    const body = {
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: 1_791_000_000_000, lte: 'now-1h' } } },
            { range: { version: { gte: '2026-10', lt: '2026-10-05 release' } } },
            { range: { at: { gte: '14:47:01', time_zone: '+02:00' } } },
          ],
        },
      },
    };
    expect(bind(body).body).toEqual(body);
  });

  test('gives a list for a node "as" list, whatever the number of values', () => {
    const body = { query: { terms: { level: { $var: 'level', as: 'list' } } } };
    expect(bind(body, { level: 'error' }).body).toEqual({ query: { terms: { level: ['error'] } } });
    expect(bind(body, { level: ['error', 'warn'] }).body).toEqual({
      query: { terms: { level: ['error', 'warn'] } },
    });
    expect(() => bind({ query: { terms: { a: { $var: 'x', as: 'set' } } } }, { x: '1' })).toThrow(
      'node of its own',
    );
  });

  test('keeps a value a value, whatever it holds', () => {
    const attack = '"}, "script": {"source": "x"}, "a": {"';
    const bound = bind({ query: { match: { message: { $var: 'text' } } } }, { text: attack });
    expect(bound.body).toEqual({ query: { match: { message: attack } } });
  });

  test('refuses scripts, runtime fields and script sorts anywhere in the body', () => {
    const bodies = [
      { query: { script_score: { query: { match_all: {} }, script: { source: '1' } } } },
      { aggs: { a: { scripted_metric: {} } } },
      { runtime_mappings: { x: { type: 'long' } } },
      { sort: [{ _script: { type: 'number' } }] },
      { query: { bool: { filter: [{ script: { script: 'doc.x' } }] } } },
      {
        query: {
          terms_set: {
            tags: { terms: ['a'], minimum_should_match_script: { source: 'params.num_terms' } },
          },
        },
      },
      { aggs: { a: { bucket_selector: { buckets_path: {}, script: 'true' } } } },
      { aggs: { a: { terms: { Script: { source: '1' } } } } },
      { query: { terms_set: { tags: { minimumShouldMatchScript: { source: '1' } } } } },
    ];
    for (const body of bodies) expect(() => bind(body)).toThrow('A query runs no script');
    expect(() => bind({ query: { match: { description: 'script' } } })).not.toThrow();
    expect(() => bind({ query: { term: { transcripts: 'a' } } })).not.toThrow();
  });

  test('refuses every parameter Elasticsearch and OpenSearch run a script for', () => {
    // The search DSL's script-bearing keys, so a new one the pattern misses fails here.
    const scriptKeys = [
      'script',
      'script_fields',
      'script_score',
      'scripted_metric',
      'init_script',
      'map_script',
      'combine_script',
      'reduce_script',
      'script_heuristic',
      'minimum_should_match_script',
      '_script',
      'runtime_mappings',
      'scriptFields',
      'minimumShouldMatchScript',
    ];
    for (const key of scriptKeys) {
      const body = { query: { bool: { filter: [{ nested: { [key]: { source: '1' } } }] } } };
      expect(() => bind(body)).toThrow('A query runs no script');
    }
  });

  test('refuses a wrapper query, which hides a script in base64', () => {
    const hidden = { script: { script: { source: "doc['secret'].value == 'x'" } } };
    const query = Buffer.from(JSON.stringify(hidden)).toString('base64');
    for (const key of ['wrapper', 'Wrapper'])
      expect(() => bind({ query: { [key]: { query } } })).toThrow('reads only what it shows');
  });

  test('refuses the queries that read documents of another index', () => {
    const bodies = [
      { query: { terms: { user: { index: 'users', id: '1', path: 'followers' } } } },
      { query: { geo_shape: { area: { indexed_shape: { index: 'shapes', id: '1' } } } } },
      { query: { percolate: { field: 'q', index: 'queries', id: '1' } } },
      { query: { more_like_this: { fields: ['a'], like: [{ _index: 'secrets', _id: '1' }] } } },
      { query: { pinned: { docs: [{ _index: 'secrets', _id: '1' }], organic: {} } } },
    ];
    for (const body of bodies) expect(() => bind(body)).toThrow('reads only what it shows');
    expect(() => bind({ query: { terms: { level: { $var: 'x' } } } }, { x: 'a' })).not.toThrow();
    expect(() => bind({ query: { term: { _index: 'logs-1' } } })).not.toThrow();
    expect(() =>
      bind({ aggs: { a: { terms: { field: 'a', order: { _count: 'desc' } } } } }),
    ).not.toThrow();
  });

  test('keeps a bucket_script that names a ratio script verbatim, and no other', () => {
    const ratio = (script: unknown, at = 'bucket_script') => ({
      aggs: {
        t: {
          terms: { field: 'service' },
          aggs: {
            _part: { filter: { term: { level: 'error' } } },
            value: { [at]: { buckets_path: { part: '_part>_count', whole: '_count' }, script } },
          },
        },
      },
    });
    for (const script of Object.values(searchRatioScripts))
      expect(bind(ratio(script)).body).toEqual(ratio(script));
    for (const body of [
      ratio('params.part * 2'),
      ratio({ source: searchRatioScripts.ratio }),
      ratio({ $var: 'script' }),
      ratio(searchRatioScripts.ratio, 'bucket_selector'),
    ])
      expect(() => bind(body, { script: searchRatioScripts.ratio })).toThrow(
        'A query runs no script',
      );
  });

  test('refuses unknown variables, malformed nodes and stray $ keys', () => {
    expect(() => bind({ query: { term: { a: { $var: 'nope' } } } })).toThrow(
      'Unknown variable nope.',
    );
    expect(() => bind({ query: { term: { a: { $var: 'x', extra: 1 } } } }, { x: '1' })).toThrow(
      'node of its own',
    );
    expect(() => bind({ query: { $vars: 'x' } })).toThrow('is not a variable');
  });

  test('refuses hidden, system and remote indices', () => {
    for (const index of ['.security', '_all', 'remote:logs', 'Logs', 'logs,.kibana', '-logs', ''])
      expect(() => bind({}, {}, index)).toThrow('An index is lowercase');
    expect(bind({}, {}, 'logs-*,metrics-2026.09,-logs-debug').index).toBe(
      'logs-*,metrics-2026.09,-logs-debug',
    );
  });

  test("takes a dot index when the connector shows its server's own indices", () => {
    const shown = (index: string) =>
      bindSearch({ index, body: {} }, {}, timeRange, { showSystem: true }).index;
    expect(shown('.kibana_1,logs-*')).toBe('.kibana_1,logs-*');
    for (const index of ['_all', 'remote:logs', 'Logs', '-logs'])
      expect(() => shown(index)).toThrow('An index is lowercase');
  });

  test('refuses a name that would reach another endpoint of the server', () => {
    const shown = (index: string) =>
      bindSearch({ index, body: {} }, {}, timeRange, { showSystem: true }).index;
    const reaching = [
      '_delete_by_query',
      'logs/_delete_by_query',
      'logs/_update/1',
      'logs/_doc/1',
      'logs/../_cluster/settings',
      'logs%2f_delete_by_query',
      'logs%2F..%2F_all',
      'logs?refresh=true',
      'logs#x',
      'logs\\_bulk',
      'logs _bulk',
      'logs\n',
      '_bulk',
      '_all',
      '_cluster',
      'logs,_all',
      'logs,',
      ',logs',
      '<logs-{now/d}>',
      'remote:logs',
    ];
    for (const index of reaching) {
      expect(() => bind({}, {}, index), index).toThrow('An index is lowercase');
      expect(() => shown(index), index).toThrow('An index is lowercase');
    }
  });

  test('refuses a name of dots, which alone in the path would search every index', () => {
    const shown = (index: string) =>
      bindSearch({ index, body: {} }, {}, timeRange, { showSystem: true }).index;
    for (const index of ['.', '..', '...', 'logs,..', 'logs,-..', '..,logs']) {
      expect(() => bind({}, {}, index), index).toThrow('An index is lowercase');
      expect(() => shown(index), index).toThrow('An index is lowercase');
    }
    expect(shown('.a,..b,logs-2026.10.13')).toBe('.a,..b,logs-2026.10.13');
  });

  test('picks a bucket width that keeps the range within a thousand buckets', () => {
    const range = (hours: number) => ({
      from: new Date(0),
      to: new Date(hours * 3_600_000),
    });
    expect(searchInterval(range(1))).toBe('5s');
    expect(searchInterval(range(24))).toBe('2m');
    expect(searchInterval(range(24 * 30))).toBe('1h');
  });
});

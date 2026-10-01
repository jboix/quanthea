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
                  },
                },
              },
            ],
          },
        },
        aggs: { t: { date_histogram: { field: '@timestamp', fixed_interval: '5s' } } },
      },
    });
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
    ];
    for (const body of bodies) expect(() => bind(body)).toThrow('A query runs no script');
    expect(() => bind({ query: { match: { description: 'script' } } })).not.toThrow();
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

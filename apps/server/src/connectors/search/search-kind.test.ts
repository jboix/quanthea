import { describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import { z } from 'zod';
import { ConnectorError } from '../_shared/index.ts';
import { aggregationsFrame } from './aggregations.ts';
import { patternOf, toEntities } from './catalog.ts';
import { fieldTypeOf, mappingDateFormats, mappingFields } from './columns.ts';
import { elasticsearchConnector } from './elasticsearch-connector.ts';
import { toConnectorError } from './errors.ts';
import { searchGuide } from './guide.ts';
import { askedPaths, flatten, hitsFrame } from './hits.ts';
import { opensearchConnector } from './opensearch-connector.ts';

for (const kind of [elasticsearchConnector, opensearchConnector]) {
  testConnectorConformance(kind, {
    config: { url: 'https://search:9200', auth: 'basic', username: 'reader' },
    secret: { password: 'x' },
    query: { language: 'search', index: 'logs-*', body: { query: { match_all: {} } } },
    invalidQuery: { language: 'search', index: 'logs-*', body: { query: { nope: {} } } },
    sampleField: { entity: 'logs-*', field: 'level' },
    timeRange: { from: new Date(0), to: new Date(1000) },
    live: false,
  });
}

const context = {
  refId: 'A',
  signal: AbortSignal.timeout(1000),
  timeoutMs: 1000,
  maxRows: 100,
  timeRange: { from: new Date(0), to: new Date(1000) },
};

describe('search connector settings', () => {
  test('offer each product its own authentication', () => {
    const modes = (kind: typeof elasticsearchConnector | typeof opensearchConnector) =>
      (z.toJSONSchema(kind.configSchema) as unknown as { properties: { auth: { enum: string[] } } })
        .properties.auth.enum;
    expect(modes(elasticsearchConnector)).toEqual(['basic', 'api-key', 'none']);
    expect(modes(opensearchConnector)).toEqual(['basic', 'bearer', 'none']);
  });

  test('say what is missing before any request', async () => {
    const connection = elasticsearchConnector.open({
      config: elasticsearchConnector.configSchema.parse({ url: 'https://search:9200' }),
      secret: {},
    });
    expect(await connection.test(AbortSignal.timeout(1000))).toMatchObject({
      ok: false,
      message: 'Basic authentication needs a username and a password.',
    });
  });
});

describe('search aggregations', () => {
  test('turn nested buckets into a long table, with a count at the leaves', () => {
    const frame = aggregationsFrame(
      { time: { date_histogram: { field: 't' }, aggs: { level: { terms: { field: 'l' } } } } },
      {
        time: {
          buckets: [
            { key: 1000, doc_count: 3, level: { buckets: [{ key: 'info', doc_count: 3 }] } },
            {
              key: 2000,
              doc_count: 2,
              level: {
                buckets: [
                  { key: 'info', doc_count: 1 },
                  { key: 'error', doc_count: 1 },
                ],
              },
            },
          ],
        },
      },
      context,
      5,
    );
    expect(frame.fields).toEqual([
      { name: 'time', type: 'time' },
      { name: 'level', type: 'string' },
      { name: 'count', type: 'number' },
    ]);
    expect(frame.values).toEqual([
      [1000, 2000, 2000],
      ['info', 'info', 'error'],
      [3, 1, 1],
    ]);
  });

  test('give metrics, percentiles and statistics their own columns', () => {
    const frame = aggregationsFrame(
      {
        by: { terms: { field: 's' }, aggs: { p: { percentiles: {} }, s: { stats: {} } } },
      },
      {
        by: {
          buckets: [
            {
              key: 'a',
              p: { values: { '50.0': 10, '95.0': null } },
              s: { count: 2, min: 1, max: 3, avg: 2, sum: 4 },
            },
          ],
        },
      },
      context,
      5,
    );
    expect(frame.fields.map((field) => field.name)).toEqual([
      'by',
      'p p50',
      'p p95',
      's count',
      's min',
      's max',
      's avg',
      's sum',
    ]);
    expect(frame.values.map((column) => column[0])).toEqual(['a', 10, null, 2, 1, 3, 2, 4]);
  });

  test('read keyed buckets, see through single-bucket aggregations, and give one row without buckets', () => {
    const keyed = aggregationsFrame(
      { f: { filter: {}, aggs: { kinds: { filters: {} } } } },
      { f: { kinds: { buckets: { ok: { doc_count: 4 }, bad: { doc_count: 1 } } } } },
      context,
      5,
    );
    expect(keyed.values).toEqual([
      ['ok', 'bad'],
      [4, 1],
    ]);
    const single = aggregationsFrame(
      { total: { sum: {} }, users: { cardinality: {} } },
      { total: { value: 12.5 }, users: { value: 3 } },
      context,
      5,
    );
    expect(single.values).toEqual([[12.5], [3]]);
  });

  test('count filters beside metrics, read their metrics, and hide helper aggregations', () => {
    const frame = aggregationsFrame(
      {
        media: {
          terms: {},
          aggs: {
            errors: { filter: {} },
            _starts: { filter: {} },
            load: { filter: {}, aggs: { p: { percentiles: {} } } },
            rate: { bucket_script: {} },
          },
        },
      },
      {
        media: {
          buckets: [
            {
              key: 'urn:a',
              doc_count: 9,
              errors: { doc_count: 2 },
              _starts: { doc_count: 8 },
              load: { doc_count: 8, p: { values: { '50.0': 410 } } },
              rate: { value: 0.25 },
            },
          ],
        },
      },
      context,
      5,
    );
    expect(frame.fields.map((field) => field.name)).toEqual(['media', 'errors', 'p p50', 'rate']);
    expect(frame.values).toEqual([['urn:a'], [2], [410], [0.25]]);
    const whole = aggregationsFrame(
      { _all: { filters: {}, aggs: { rate: { bucket_script: {} } } } },
      { _all: { buckets: { all: { doc_count: 3, rate: { value: 0.5 } } } } },
      context,
      5,
    );
    expect(whole.fields).toEqual([{ name: 'rate', type: 'number' }]);
  });

  test('give each field of a multi_terms its own column, named after the field', () => {
    const frame = aggregationsFrame(
      {
        pairs: {
          multi_terms: { terms: [{ field: 'platform' }, { field: 'player.version' }] },
          aggs: { p: { percentiles: {} } },
        },
      },
      {
        pairs: {
          buckets: [
            { key: ['ios', '2.10'], key_as_string: 'ios|2.10', doc_count: 3, p: { values: {} } },
            { key: ['web', 9], key_as_string: 'web|9', doc_count: 1, p: { values: {} } },
          ],
        },
      },
      context,
      5,
    );
    expect(frame.fields.slice(0, 2)).toEqual([
      { name: 'platform', type: 'string' },
      { name: 'player.version', type: 'string' },
    ]);
    expect(frame.values.slice(0, 2)).toEqual([
      ['ios', 'web'],
      ['2.10', '9'],
    ]);
    const scripted = aggregationsFrame(
      { pairs: { multi_terms: { terms: [{ field: 'a' }, { script: 'x' }] } } },
      { pairs: { buckets: [{ key: ['x', 'y'], key_as_string: 'x|y', doc_count: 2 }] } },
      context,
      5,
    );
    expect(scripted.values).toEqual([['x|y'], [2]]);
  });

  test('add an "Other" row with the documents outside the buckets when the grouping asks', () => {
    const answer = {
      browser: {
        sum_other_doc_count: 40,
        buckets: [{ key: 'chrome', doc_count: 9, value: { value: 9 } }],
      },
    };
    const asked = aggregationsFrame(
      { browser: { terms: {}, meta: { other: ['value'] }, aggs: { value: { value_count: {} } } } },
      answer,
      context,
      5,
    );
    expect(asked.values).toEqual([
      ['chrome', 'Other'],
      [9, 40],
    ]);
    const unasked = aggregationsFrame(
      { browser: { terms: {}, aggs: { value: { value_count: {} } } } },
      answer,
      context,
      5,
    );
    expect(unasked.values).toEqual([['chrome'], [9]]);
    const none = aggregationsFrame(
      { browser: { terms: {}, meta: { other: ['value'] }, aggs: { value: { value_count: {} } } } },
      { browser: { sum_other_doc_count: 0, buckets: [] } },
      context,
      5,
    );
    expect(none.meta.rowCount).toBe(0);
  });

  test('refuse bucket aggregations side by side, and stop at the row limit', () => {
    expect(() => aggregationsFrame({ a: { terms: {} }, b: { terms: {} } }, {}, context, 5)).toThrow(
      ConnectorError,
    );
    const buckets = Array.from({ length: 5 }, (_, key) => ({ key, doc_count: 1 }));
    const frame = aggregationsFrame(
      { n: { histogram: {} } },
      { n: { buckets } },
      { ...context, maxRows: 2 },
      5,
    );
    expect(frame.meta).toMatchObject({ rowCount: 2, truncated: true });
  });
});

describe('search documents', () => {
  test('flatten objects to dotted columns, typed from the mapping', () => {
    expect([...flatten({ a: { b: 1, c: [1, 2] }, d: null })]).toEqual([
      ['a.b', 1],
      ['a.c', [1, 2]],
      ['d', null],
    ]);
    const frame = hitsFrame(
      [{ _source: { at: '2026-09-27T12:02:00Z', http: { status: 502 }, tags: ['a'] } }],
      new Map([
        ['at', 'date'],
        ['http.status', 'integer'],
      ]),
      context,
      5,
    );
    expect(frame.fields).toEqual([
      { name: 'at', type: 'time' },
      { name: 'http.status', type: 'number' },
      { name: 'tags', type: 'string' },
    ]);
    expect(frame.values).toEqual([[Date.UTC(2026, 8, 27, 12, 2)], [502], ['["a"]']]);
  });

  test('put the fields the request lists first, in its order', () => {
    const hits = [{ _source: { at: 1, http: { status: 502 }, user: 'u' } }];
    const asked = askedPaths(['user', 'http.status', 'missing', 'x*']);
    expect(asked).toEqual(['user', 'http.status', 'missing']);
    const frame = hitsFrame(hits, new Map(), context, 5, asked);
    expect(frame.fields.map((field) => field.name)).toEqual(['user', 'http.status', 'at']);
    expect(askedPaths({ includes: ['a'] })).toEqual([]);
  });
});

describe('search mappings and catalog', () => {
  test('map field types and walk objects and multi-fields', () => {
    expect(['long', 'scaled_float', 'date_nanos', 'boolean', 'keyword'].map(fieldTypeOf)).toEqual([
      'number',
      'number',
      'time',
      'boolean',
      'string',
    ]);
    const fields = mappingFields({
      message: { type: 'text', fields: { keyword: { type: 'keyword' } } },
      http: { properties: { status: { type: 'integer' } } },
    });
    expect([...fields]).toEqual([
      ['message', 'text'],
      ['message.keyword', 'keyword'],
      ['http.status', 'integer'],
    ]);
  });

  test('group daily and rollover indices under the pattern that queries them', () => {
    expect(['logs-2026.09.29', 'app_2026-09', 'events-000042', 'orders'].map(patternOf)).toEqual([
      'logs-*',
      'app_*',
      'events-*',
      'orders',
    ]);
    const mapping = { mappings: { properties: { level: { type: 'keyword' } } } };
    const entities = toEntities(
      { 'logs-2026.09.29': mapping, 'logs-2026.09.30': mapping, orders: mapping },
      [
        { index: 'logs-2026.09.29', 'docs.count': '10' },
        { index: 'logs-2026.09.30', 'docs.count': '5' },
      ],
    );
    expect(entities).toEqual([
      {
        name: 'logs-*',
        kind: 'index',
        description: '2 indices, logs-2026.09.29 to logs-2026.09.30.',
        rowEstimate: 15,
        fields: [{ name: 'level', nativeType: 'keyword', type: 'string' }],
      },
      {
        name: 'orders',
        kind: 'index',
        rowEstimate: 0,
        fields: [{ name: 'level', nativeType: 'keyword', type: 'string' }],
      },
    ]);
  });

  test('a pattern names a date format only when every index with the field names the same', () => {
    const indexOf = (properties: Record<string, unknown>) => ({ mappings: { properties } });
    const millis = { type: 'date', format: 'epoch_millis' };
    const [entity] = toEntities(
      {
        'logs-2026.09.28': indexOf({ at: millis, seen: millis, old: millis, both: millis }),
        'logs-2026.09.29': indexOf({ at: { type: 'date' }, seen: millis, both: millis }),
        'logs-2026.09.30': indexOf({
          at: millis,
          seen: millis,
          both: { type: 'date', format: 'strict_date_time' },
        }),
      },
      [],
    );
    expect(entity?.fields).toEqual([
      { name: 'at', nativeType: 'date', type: 'time' },
      { name: 'seen', nativeType: 'date (epoch_millis)', type: 'time' },
      { name: 'old', nativeType: 'date (epoch_millis)', type: 'time' },
      { name: 'both', nativeType: 'date', type: 'time' },
    ]);
  });

  test('name a date field with the format its mapping stores it in', () => {
    const properties = {
      '@timestamp': { type: 'date', format: 'epoch_millis' },
      seen: { type: 'date' },
      session: { properties: { started: { type: 'date_nanos', format: 'strict_date_time' } } },
      level: { type: 'keyword', format: 'ignored' },
    };
    expect([...mappingDateFormats(properties)]).toEqual([
      ['@timestamp', 'epoch_millis'],
      ['session.started', 'strict_date_time'],
    ]);
    const [entity] = toEntities({ core_events: { mappings: { properties } } }, []);
    expect(entity?.fields).toEqual([
      { name: '@timestamp', nativeType: 'date (epoch_millis)', type: 'time' },
      { name: 'seen', nativeType: 'date', type: 'time' },
      { name: 'session.started', nativeType: 'date_nanos (strict_date_time)', type: 'time' },
      { name: 'level', nativeType: 'keyword', type: 'string' },
    ]);
  });

  test('the guide tells a count of start events from a distinct count of sessions', () => {
    const guide = searchGuide('OpenSearch');
    expect(guide).toContain('counts the sessions started in the range');
    expect(guide).toContain('a cardinality of the session id counts every session seen');
    expect(guide).toContain("say in the panel's description which one it counts");
  });

  test('the guide says a range bound is ISO text whatever the format of the field', () => {
    const guide = searchGuide('Elasticsearch');
    expect(guide).toContain('date (epoch_millis)');
    expect(guide).toContain('a date in ISO 8601 text such as "2026-10-05T14:47:01Z"');
  });
});

describe('search errors', () => {
  test('map error types to codes, and hide the reason of an error that is not about the query', () => {
    const cases: [number, object, string][] = [
      [401, { type: 'security_exception', reason: 'secret' }, 'authentication'],
      [403, { type: 'security_exception', reason: 'secret' }, 'permission'],
      [503, { type: 'something_new', reason: 'secret' }, 'internal'],
      [429, { type: 'circuit_breaking_exception', reason: 'secret' }, 'rejected'],
    ];
    for (const [status, error, code] of cases) {
      const converted = toConnectorError(status, error, 'The search server');
      expect(converted).toMatchObject({ code });
      expect(converted.safeMessage).not.toContain('secret');
      expect(converted.message).toContain('secret');
    }
  });

  test('carry the reason of an error about how the query is written, so it can be fixed', () => {
    const reason =
      'failed to parse date field [2026-10-12T11:55:24.000Z] with format [epoch_millis]';
    const failed = {
      type: 'search_phase_execution_exception',
      root_cause: [{ type: 'parse_exception', reason }],
    };
    expect(toConnectorError(400, failed, 'The search server')).toMatchObject({
      code: 'syntax',
      safeMessage: `A value of the search cannot be read. The server says: ${reason}`,
    });
    const parsing = { type: 'parsing_exception', reason: 'unknown query [matc]' };
    expect(toConnectorError(400, parsing, 'x').safeMessage).toBe(
      'The search body has an error. The server says: unknown query [matc]',
    );
  });

  test('carry why a bucket script failed, which a failed search holds under its cause', () => {
    const failed = (reason: string, behind: object) => ({
      type: 'search_phase_execution_exception',
      reason: '',
      root_cause: [],
      caused_by: { type: 'script_exception', reason, caused_by: behind },
    });
    const cast = {
      type: 'class_cast_exception',
      reason: 'Cannot apply [>] operation to types [java.lang.Double] and [java.lang.String].',
    };
    expect(toConnectorError(400, failed('runtime error', cast), 'x')).toMatchObject({
      code: 'syntax',
      safeMessage: `A script of the search has an error. The server says: runtime error: ${cast.reason}`,
    });
    const overflow = { type: 'stack_overflow_error', reason: null };
    expect(toConnectorError(400, failed('runtime error', overflow), 'x').safeMessage).toBe(
      'A script of the search has an error. The server says: runtime error: stack_overflow_error',
    );
    const other = {
      type: 'search_phase_execution_exception',
      caused_by: { type: 'x', reason: 'secret' },
    };
    expect(toConnectorError(400, other, 'x').safeMessage).not.toContain('secret');
  });

  test('cut a long reason short', () => {
    const long = { type: 'parsing_exception', reason: 'x'.repeat(1000) };
    expect(toConnectorError(400, long, 'x').safeMessage.length).toBeLessThan(400);
  });

  test('name a missing index, which is schema rather than data', () => {
    expect(
      toConnectorError(404, { type: 'index_not_found_exception', index: 'nope' }, 'x'),
    ).toMatchObject({ code: 'not_found', safeMessage: 'Index "nope" does not exist.' });
  });
});

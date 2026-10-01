import { describe, expect, test } from 'bun:test';
import { queryText, type SavedQuery, savedQuerySchema } from '@quanthea/shared';
import { z } from 'zod';
import { buildData } from './build.ts';
import { availableIn, dataSchemaFor } from './request.ts';

const failedBy: SavedQuery = savedQuerySchema.parse({
  id: 'failed-by',
  name: 'Failed by column',
  description: 'Failed rows by a column.',
  language: 'sql',
  query:
    'SELECT {{column}} AS name, count(*) AS value FROM {{table}} WHERE status = {{status}} GROUP BY 1',
  params: [
    { name: 'column', kind: 'column' },
    { name: 'table', kind: 'table' },
    { name: 'status', kind: 'value' },
  ],
  shape: 'long',
});

const queueDepth: SavedQuery = savedQuerySchema.parse({
  id: 'queue-depth',
  name: 'Queue depth',
  description: 'Messages waiting, averaged over a window.',
  language: 'promql',
  query: 'avg_over_time({{metric}}{queue={{queue}}}[{{window}}])',
  params: [
    { name: 'metric', kind: 'metric' },
    { name: 'queue', kind: 'value' },
    { name: 'window', kind: 'duration' },
  ],
  shape: 'long',
});

/**
 * A saved query with placeholders of the kind `value` unless named otherwise.
 *
 * @param id - Its id.
 * @param language - Its language.
 * @param query - Its text.
 * @param kinds - The kind of each placeholder.
 * @returns The saved query.
 */
function saved(
  id: string,
  language: SavedQuery['language'],
  query: string,
  kinds: Record<string, string>,
): SavedQuery {
  const params = Object.entries(kinds).map(([name, kind]) => ({ name, kind }));
  return savedQuerySchema.parse({ id, name: id, description: id, language, query, params });
}

const mediaErrors = saved(
  'media-errors',
  'search',
  JSON.stringify({
    index: '{{index}}',
    body: {
      query: { bool: { filter: [{ term: { 'session.media.id': '{{media}}' } }] } },
      aggs: { '{{field}}': { terms: { field: '{{field}}' } } },
    },
  }),
  { index: 'table', media: 'value', field: 'column' },
);

const mediaList = saved(
  'media-list',
  'http',
  JSON.stringify({
    path: '/integrationlayer/2.0/mediaList/byUrns/{{bu}}',
    query: { urns: '{{urns}}' },
    body: { note: '{{urns}}' },
    extract: { rows: '/mediaList' },
  }),
  { bu: 'value', urns: 'value' },
);

const errorLines = saved(
  'error-lines',
  'logql',
  'sum by ({{label}}) (count_over_time({service={{service}}} |= {{text}} [{{window}}]))',
  { label: 'label', service: 'value', text: 'value', window: 'duration' },
);

const serviceHash = saved('service-hash', 'redis', 'HGETALL service:{{service}}', {
  service: 'value',
});

const failedOrders = saved(
  'failed-orders',
  'mongodb',
  JSON.stringify({
    collection: '{{collection}}',
    pipeline: [{ $match: { status: '{{status}}' } }],
  }),
  { collection: 'table', status: 'value' },
);

const available = {
  builtIn: ['rate'],
  saved: [failedBy, queueDepth, mediaErrors, mediaList, errorLines, serviceHash, failedOrders],
};

/**
 * The query a saved query builds.
 *
 * @param name - The saved query.
 * @param params - The values.
 * @returns The panel query.
 */
function savedOf(name: string, params: Record<string, string>) {
  const request = dataSchemaFor(available).parse({ kind: 'saved', name, connector: 'c', params });
  return buildData(request, { saved: available.saved }).queries[0];
}

/**
 * The query text a saved query builds.
 *
 * @param data - The data request.
 * @returns The query text.
 */
function queryOf(data: Record<string, unknown>): string {
  const request = dataSchemaFor(available).parse(data);
  const query = buildData(request, { saved: available.saved }).queries[0];
  return query ? queryText(query) : '';
}

describe('saved queries', () => {
  test('quote names, escape literals and bind variables in SQL', () => {
    const base = { kind: 'saved', name: 'failed-by', connector: 'shop' };
    expect(
      queryOf({ ...base, params: { column: 'region', table: 'shop.orders', status: "it's" } }),
    ).toBe(
      `SELECT "region" AS name, count(*) AS value FROM "shop"."orders" WHERE status = 'it''s' GROUP BY 1`,
    );
    expect(
      queryOf({ ...base, params: { column: 'region', table: 'orders', status: '$status' } }),
    ).toContain('WHERE status = :status');
  });

  test('check metrics and durations, and quote values in PromQL', () => {
    const base = { kind: 'saved', name: 'queue-depth', connector: 'prom' };
    const params = { metric: 'queue_depth', queue: 'mail"}', window: '$interval' };
    expect(queryOf({ ...base, params })).toBe(
      'avg_over_time(queue_depth{queue="mail\\"}"}[$interval])',
    );
    expect(() => queryOf({ ...base, params: { ...params, window: '5m) or vector(1' } })).toThrow(
      'is not a duration',
    );
    expect(() => queryOf({ ...base, params: { ...params, metric: 'up or 1' } })).toThrow(
      'is not a metric name',
    );
  });

  test('refuse a missing value and an unknown saved query', () => {
    const base = { kind: 'saved', connector: 'shop' };
    expect(() => queryOf({ ...base, name: 'failed-by', params: { column: 'region' } })).toThrow(
      'needs a value for table',
    );
    expect(() => queryOf({ ...base, name: 'nope' })).toThrow('No saved query "nope".');
  });

  test('keep the builders and saved queries of the connectors’ languages', () => {
    expect(
      availableIn(
        { builtIn: ['rate', 'sql-stat', 'search-ratio'], saved: [failedBy, queueDepth] },
        new Set(['sql']),
      ),
    ).toEqual({
      builtIn: ['sql-stat'],
      saved: [failedBy],
    });
  });

  test('offer only the thread’s queries in the tool schema', () => {
    const schemaOf = (queries: typeof available) =>
      JSON.stringify(z.toJSONSchema(dataSchemaFor(queries), { io: 'input' }));
    const chosen = schemaOf({ builtIn: ['rate'], saved: [] });
    expect(chosen).toContain('"rate"');
    expect(chosen).not.toContain('"latency"');
    expect(chosen).not.toContain('"saved"');
    expect(schemaOf({ builtIn: [], saved: [queueDepth] })).toContain('"saved"');
    expect(schemaOf({ builtIn: [], saved: [] })).toContain('"raw"');
  });
});

describe('saved queries in JSON languages', () => {
  test('fill a search with names as keys and a variable as a node', () => {
    const query = savedOf('media-errors', {
      index: 'events-*',
      media: '$media',
      field: 'data.error_type',
    });
    expect(query).toEqual({
      refId: 'A',
      connector: 'c',
      language: 'search',
      index: 'events-*',
      body: {
        query: { bool: { filter: [{ term: { 'session.media.id': { $var: 'media' } } }] } },
        aggs: { 'data.error_type': { terms: { field: 'data.error_type' } } },
      },
    });
    expect(() => savedOf('media-errors', { index: 'x', media: 'y', field: 'a b' })).toThrow(
      'is not a field name',
    );
  });

  test('fill an HTTP path and query inside text, the body only whole', () => {
    expect(savedOf('media-list', { bu: 'srf/../x', urns: '$urns' })).toMatchObject({
      path: '/integrationlayer/2.0/mediaList/byUrns/srf%2F..%2Fx',
      query: { urns: '$urns' },
      body: { note: { $var: 'urns' } },
    });
    expect(() => savedOf('media-list', { bu: 'a$b', urns: 'x' })).toThrow('holds a $');
  });

  test('fill a MongoDB pipeline, and refuse a placeholder inside a string', () => {
    expect(savedOf('failed-orders', { collection: 'orders', status: 'failed' })).toMatchObject({
      collection: 'orders',
      pipeline: [{ $match: { status: 'failed' } }],
    });
    const partial = saved(
      'partial',
      'mongodb',
      JSON.stringify({ collection: 'o', pipeline: [{ $match: { id: 'urn:{{id}}' } }] }),
      { id: 'value' },
    );
    expect(() =>
      buildData(
        dataSchemaFor({ builtIn: [], saved: [partial] }).parse({
          kind: 'saved',
          name: 'partial',
          connector: 'c',
          params: { id: '1' },
        }),
        { saved: [partial] },
      ),
    ).toThrow('alone in its string');
  });
});

describe('saved queries in LogQL and Redis', () => {
  test('quote LogQL values and check its names and durations', () => {
    const query = savedOf('error-lines', {
      label: 'route',
      service: '$service',
      text: 'time"out',
      window: '5m',
    });
    expect(query && queryText(query)).toBe(
      'sum by (route) (count_over_time({service="$service"} |= "time\\"out" [5m]))',
    );
  });

  test('fill a Redis argument, keeping a variable for the binder', () => {
    expect(savedOf('service-hash', { service: '$service' })).toMatchObject({
      command: 'HGETALL',
      args: ['service:$service'],
    });
    expect(savedOf('service-hash', { service: 'cart svc' })).toMatchObject({
      args: ['service:cart svc'],
    });
  });
});

describe('saved query settings', () => {
  test('need JSON templates for JSON languages', () => {
    const result = savedQuerySchema.safeParse({ ...failedOrders, query: '{"collection": {{c}}}' });
    expect(result.error?.issues[0]?.message).toContain('JSON object');
  });

  test('need every placeholder declared and used', () => {
    const result = savedQuerySchema.safeParse({
      ...failedBy,
      query: 'SELECT {{other}} FROM {{table}}',
    });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Declare the placeholders other.',
      'Unused: column, status.',
    ]);
  });
});

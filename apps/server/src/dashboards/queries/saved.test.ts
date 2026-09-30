import { describe, expect, test } from 'bun:test';
import { queryText, type SavedQuery, savedQuerySchema } from '@querent/shared';
import { z } from 'zod';
import { buildData } from './build.ts';
import { dataSchemaFor } from './request.ts';

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

const available = { builtIn: ['rate'], saved: [failedBy, queueDepth] };

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

describe('saved query settings', () => {
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

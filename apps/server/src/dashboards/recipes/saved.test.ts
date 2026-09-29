import { describe, expect, test } from 'bun:test';
import type { SavedQuery } from '@querent/shared';
import { savedQuerySchema } from '@querent/shared';
import { z } from 'zod';
import { applyEdit } from './edit.ts';
import { editRequestSchemaFor } from './request.ts';

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
  show: 'category-bar',
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
  show: 'line',
});

const available = { builtIn: ['rate'], saved: [failedBy, queueDepth] };

/**
 * The query text of the one panel a saved recipe builds.
 *
 * @param panel - The panel request.
 * @returns The query text.
 */
function queryOf(panel: Record<string, unknown>): string {
  const request = editRequestSchemaFor(available).parse({
    title: 'T',
    summary: 's',
    panels: [panel],
  });
  const query = applyEdit(undefined, request, available.saved).panels[0]?.queries[0];
  return query?.language === 'sql' ? query.sql : (query?.expr ?? '');
}

describe('saved recipes', () => {
  test('quote names, escape literals and bind variables in SQL', () => {
    const base = { recipe: 'saved', name: 'failed-by', connector: 'shop', title: 'Failed' };
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
    const base = { recipe: 'saved', name: 'queue-depth', connector: 'prom', title: 'Depth' };
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

  test('refuse a missing value and an unknown recipe', () => {
    const base = { recipe: 'saved', connector: 'shop', title: 'Failed' };
    expect(() => queryOf({ ...base, name: 'failed-by', params: { column: 'region' } })).toThrow(
      'needs a value for table',
    );
    expect(() => queryOf({ ...base, name: 'nope' })).toThrow('No saved recipe "nope".');
  });

  test('offer only the thread’s recipes in the tool schema', () => {
    const schemaOf = (recipes: typeof available) =>
      JSON.stringify(z.toJSONSchema(editRequestSchemaFor(recipes), { io: 'input' }));
    const chosen = schemaOf({ builtIn: ['rate'], saved: [] });
    expect(chosen).toContain('"rate"');
    expect(chosen).not.toContain('"latency"');
    expect(chosen).not.toContain('"saved"');
    expect(schemaOf({ builtIn: [], saved: [queueDepth] })).toContain('"saved"');
    expect(schemaOf({ builtIn: [], saved: [] })).toContain('"custom"');
  });
});

describe('saved recipe settings', () => {
  test('need every placeholder declared and used, and columns for a table', () => {
    const result = savedQuerySchema.safeParse({
      ...failedBy,
      query: 'SELECT {{other}} FROM {{table}}',
      show: 'table',
      columns: undefined,
    });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Declare the placeholders other.',
      'Unused: column, status.',
      'A table needs its columns.',
    ]);
  });
});

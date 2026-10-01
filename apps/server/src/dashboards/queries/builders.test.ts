import { describe, expect, test } from 'bun:test';
import { queryBuilders } from '@querent/shared';
import { firstBuild, queriesOf, specOf } from '../panels/fixtures.ts';
import { buildData } from './build.ts';
import { builderGuides } from './guide.ts';
import { dataSchema } from './request.ts';

describe('the query builders', () => {
  test('write PromQL with matchers, windows, and every percentile in one query', () => {
    const [ratio, , latency, , top] = queriesOf(specOf(undefined, firstBuild));
    expect(ratio).toEqual([
      'sum (rate(http_requests_total{service=~"$service",code=~"5.."}[$interval])) / sum (rate(http_requests_total{service=~"$service"}[$interval]))',
    ]);
    expect(latency).toEqual([
      'label_replace(histogram_quantile(0.5, sum by (le, service) (rate(http_request_duration_seconds_bucket[$__rate_interval]))), "quantile", "p50", "", "") or label_replace(histogram_quantile(0.95, sum by (le, service) (rate(http_request_duration_seconds_bucket[$__rate_interval]))), "quantile", "p95", "", "")',
    ]);
    expect(top).toEqual(['topk(10, sum by (code) (increase(http_requests_total[$__range])))']);
  });

  test('write SQL with quoted names, escaped literals and bound variables', () => {
    const [, stat, , series] = queriesOf(specOf(undefined, firstBuild));
    expect(stat).toEqual([
      `SELECT count(*) AS value FROM "orders" WHERE "created_at" BETWEEN :__from AND :__to AND "status" = 'failed'`,
    ]);
    expect(series).toEqual([
      'SELECT date_bin(:interval::interval, "created_at", :__from) AS time, "status"::text AS series, count(*) AS value FROM "orders" WHERE "created_at" BETWEEN :__from AND :__to AND "service" IN (:service) GROUP BY 1, 2 ORDER BY 1',
    ]);
    const quoted = buildData(
      dataSchema.parse({
        kind: 'sql-stat',
        connector: 'shop',
        table: 'orders',
        filters: [{ field: 'note', value: "it's" }],
      }),
    );
    expect(quoted.queries[0]?.language === 'sql' && quoted.queries[0].sql).toContain(
      `"note" = 'it''s'`,
    );
  });

  test('write a SQL ratio with CASE sums, guarded against zero', () => {
    const ratio = buildData(
      dataSchema.parse({
        kind: 'sql-ratio',
        connector: 'shop',
        table: 'orders',
        time: 'created_at',
        over: 'range',
        by: 'service',
        match: [{ field: 'status', value: 'failed' }],
        of: [{ field: 'status', op: '!=', value: 'refunded' }],
        complement: true,
      }),
    );
    expect(ratio.queries[0]?.language === 'sql' && ratio.queries[0].sql).toBe(
      `SELECT "service"::text AS "service", 1 - 1e0 * sum(CASE WHEN "status" = 'failed' THEN 1 ELSE 0 END) / nullif(sum(CASE WHEN "status" <> 'refunded' THEN 1 ELSE 0 END), 0) AS value FROM "orders" WHERE "created_at" BETWEEN :__from AND :__to GROUP BY 1 ORDER BY sum(CASE WHEN "status" = 'failed' THEN 1 ELSE 0 END) DESC LIMIT 10`,
    );
    expect(() =>
      buildData(
        dataSchema.parse({
          kind: 'sql-ratio',
          connector: 'shop',
          table: 'orders',
          match: [{ field: 'status', value: 'failed' }],
        }),
      ),
    ).toThrow('needs a time column');
  });

  test('say what they return: a shape, its columns and a chart that suits it', () => {
    const rate = buildData(
      dataSchema.parse({ kind: 'rate', connector: 'prom', metric: 'up', by: ['job', 'code'] }),
    );
    expect(rate.output).toEqual({
      shape: 'long',
      columns: ['time', 'code', 'job', 'series', 'value'],
      chart: 'trend.line',
      unit: 'per-second',
    });
    const raw = buildData(
      dataSchema.parse({
        kind: 'raw',
        connector: 'shop',
        language: 'sql',
        query: 'SELECT 1 AS value',
      }),
    );
    expect(raw).toEqual({
      queries: [{ refId: 'A', connector: 'shop', language: 'sql', sql: 'SELECT 1 AS value' }],
      output: { shape: 'rows', columns: [], chart: 'table.rows' },
    });
  });

  test('refuse names that are not names', () => {
    expect(
      dataSchema.safeParse({ kind: 'sql-stat', connector: 'shop', table: 'orders; DROP TABLE x' })
        .error?.message,
    ).toContain('Use a table name');
    const metric = dataSchema.parse({ kind: 'rate', connector: 'prom', metric: 'up) or vector(1' });
    expect(() => buildData(metric)).toThrow('is not a metric name');
  });

  test('describe every builder with its fields, an example, its queries and its output', () => {
    const guides = builderGuides();
    const rate = guides.find((guide) => guide.id === 'rate');
    expect(rate?.fields.find((field) => field.name === 'window')).toMatchObject({
      required: false,
      default: '$__rate_interval',
    });
    expect(rate?.queries).toEqual([
      'sum by (code) (rate(http_requests_total{service="$service"}[$__rate_interval]))',
    ]);
    expect(rate?.output).toEqual({
      shape: 'long',
      columns: ['time', 'code', 'series', 'value'],
      chart: 'trend.line',
    });
    expect(guides).toHaveLength(queryBuilders.length);
  });
});

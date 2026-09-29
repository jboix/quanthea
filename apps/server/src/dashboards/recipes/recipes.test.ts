import { describe, expect, test } from 'bun:test';
import type { DashboardSpec } from '@querent/shared';
import type { ConnectorLookup } from '../check-queries.ts';
import { validateSpec } from '../validate.ts';
import { applyEdit } from './edit.ts';
import { type EditRequest, editRequestSchema } from './request.ts';

const guardrails = { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 };

const lookup: ConnectorLookup = (name) =>
  ({
    prom: { language: 'promql', guardrails },
    shop: { language: 'sql', guardrails },
  })[name] as ReturnType<ConnectorLookup>;

/**
 * An edit, with the schema's defaults filled in as the tool receives it.
 *
 * @param input - The edit as the model writes it.
 * @returns The parsed edit.
 */
function edit(input: unknown): EditRequest {
  return editRequestSchema.parse(input);
}

/**
 * The issues the real validation finds in a spec.
 *
 * @param spec - The spec.
 * @returns The issues, as `path: message`.
 */
function issuesOf(spec: DashboardSpec): string[] {
  const result = validateSpec(spec, { lookup, now: Date.parse('2026-09-29T12:00:00Z') });
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

/**
 * The query text of each panel.
 *
 * @param spec - The spec.
 * @returns One list per panel.
 */
function queriesOf(spec: DashboardSpec): string[][] {
  return spec.panels.map((panel) =>
    panel.queries.map((query) => (query.language === 'sql' ? query.sql : query.expr)),
  );
}

const interval = { kind: 'interval', name: 'interval', options: ['1m', '5m'], default: '5m' };
const service = {
  kind: 'custom',
  name: 'service',
  options: ['checkout', 'cart'],
  default: ['checkout'],
  multi: true,
};

const firstBuild = edit({
  title: 'Checkout',
  variables: [interval, service],
  add: [
    {
      recipe: 'ratio',
      title: 'Error rate',
      connector: 'prom',
      metric: 'http_requests_total',
      filters: [{ field: 'service', op: '=~', value: '$service' }],
      match: [{ field: 'code', op: '=~', value: '5..' }],
      window: '$interval',
      show: 'stat',
    },
    {
      recipe: 'sql-stat',
      title: 'Failed orders',
      connector: 'shop',
      table: 'orders',
      time: 'created_at',
      filters: [{ field: 'status', value: 'failed' }],
    },
    {
      recipe: 'latency',
      title: 'Latency',
      connector: 'prom',
      metric: 'http_request_duration_seconds_bucket',
      quantiles: [0.5, 0.95],
      by: ['service'],
    },
    {
      recipe: 'sql-series',
      title: 'Orders by status',
      connector: 'shop',
      table: 'orders',
      time: 'created_at',
      by: 'status',
      bucket: '$interval',
      filters: [{ field: 'service', value: '$service' }],
    },
    {
      recipe: 'top',
      title: 'Top codes',
      connector: 'prom',
      metric: 'http_requests_total',
      by: ['code'],
    },
  ],
  summary: 'first build',
});

describe('recipes', () => {
  test('write PromQL with matchers, windows and percentiles', () => {
    const [ratio, , latency, , top] = queriesOf(applyEdit(undefined, firstBuild));
    expect(ratio).toEqual([
      'sum (rate(http_requests_total{service=~"$service",code=~"5.."}[$interval])) / sum (rate(http_requests_total{service=~"$service"}[$interval]))',
    ]);
    expect(latency).toEqual([
      'histogram_quantile(0.5, sum by (le, service) (rate(http_request_duration_seconds_bucket[$__rate_interval])))',
      'histogram_quantile(0.95, sum by (le, service) (rate(http_request_duration_seconds_bucket[$__rate_interval])))',
    ]);
    expect(top).toEqual(['topk(10, sum by (code) (increase(http_requests_total[$__range])))']);
  });

  test('write SQL with quoted names, escaped literals and bound variables', () => {
    const [, stat, , series] = queriesOf(applyEdit(undefined, firstBuild));
    expect(stat).toEqual([
      `SELECT count(*) AS value FROM "orders" WHERE "created_at" BETWEEN :__from AND :__to AND "status" = 'failed'`,
    ]);
    expect(series).toEqual([
      'SELECT date_bin(:interval::interval, "created_at", :__from) AS time, "status"::text AS series, count(*) AS value FROM "orders" WHERE "created_at" BETWEEN :__from AND :__to AND "service" IN (:service) GROUP BY 1, 2 ORDER BY 1',
    ]);
    const quoted = applyEdit(
      undefined,
      edit({
        title: 'Quotes',
        add: [
          {
            recipe: 'sql-stat',
            title: 'x',
            connector: 'shop',
            table: 'orders',
            filters: [{ field: 'note', value: "it's" }],
          },
        ],
        summary: 'x',
      }),
    );
    expect(queriesOf(quoted)[0]?.[0]).toContain(`"note" = 'it''s'`);
  });

  test('refuse names that are not names', () => {
    const bad = {
      title: 'x',
      add: [{ recipe: 'sql-stat', title: 'x', connector: 'shop', table: 'orders; DROP TABLE x' }],
      summary: 'x',
    };
    expect(() => edit(bad)).toThrow('Use a table name');
    const metric = edit({
      title: 'x',
      add: [{ recipe: 'rate', title: 'x', connector: 'prom', metric: 'up) or vector(1' }],
      summary: 'x',
    });
    expect(() => applyEdit(undefined, metric)).toThrow('is not a metric name');
  });

  test('produce specs the real validation accepts', () => {
    expect(issuesOf(applyEdit(undefined, firstBuild))).toEqual([]);
  });
});

describe('applyEdit', () => {
  test('lays out stats in a row and charts below, in reading order', () => {
    const grids = applyEdit(undefined, firstBuild).panels.map((panel) => [panel.id, panel.grid]);
    expect(grids).toEqual([
      ['error-rate', { x: 0, y: 0, w: 3, h: 3 }],
      ['failed-orders', { x: 3, y: 0, w: 3, h: 3 }],
      ['latency', { x: 0, y: 3, w: 12, h: 8 }],
      ['orders-by-status', { x: 0, y: 11, w: 12, h: 8 }],
      ['top-codes', { x: 0, y: 19, w: 6, h: 7 }],
    ]);
  });

  test('rebuilds a panel in place, removes one, and adds below the rest', () => {
    const built = applyEdit(undefined, firstBuild);
    const changed = applyEdit(
      built,
      edit({
        replace: [
          {
            panelId: 'latency',
            panel: {
              recipe: 'latency',
              title: 'p99',
              connector: 'prom',
              metric: 'http_request_duration_seconds',
              quantiles: [0.99],
            },
          },
        ],
        remove: ['top-codes'],
        add: [
          {
            recipe: 'gauge',
            title: 'Memory',
            connector: 'prom',
            metric: 'process_resident_memory_bytes',
            unit: 'bytes',
          },
        ],
        summary: 'p99 only',
      }),
    );
    const latency = changed.panels.find((panel) => panel.id === 'latency');
    expect(latency?.title).toBe('p99');
    expect(latency?.grid).toEqual({ x: 0, y: 3, w: 12, h: 8 });
    expect(changed.panels.map((panel) => panel.id)).toEqual([
      'error-rate',
      'failed-orders',
      'latency',
      'orders-by-status',
      'memory',
    ]);
    expect(changed.panels.at(-1)?.grid).toEqual({ x: 0, y: 19, w: 12, h: 8 });
    expect(issuesOf(changed)).toEqual([]);
  });

  test('says which panels exist when an edit names another', () => {
    const built = applyEdit(undefined, firstBuild);
    expect(() => applyEdit(built, edit({ remove: ['nope'], summary: 'x' }))).toThrow(
      'No panel "nope". The panels are: error-rate, failed-orders, latency, orders-by-status, top-codes.',
    );
  });

  test('puts deploy markers on every time chart, and takes them off', () => {
    const markers = {
      label: 'deploy',
      connector: 'shop',
      table: 'deploys',
      time: 'deployed_at',
      text: 'version',
    };
    const marked = applyEdit(
      applyEdit(undefined, firstBuild),
      edit({ markers, summary: 'markers' }),
    );
    const markedIds = marked.panels
      .filter((panel) => panel.view.kind === 'chart' && panel.view.markers?.length)
      .map((panel) => panel.id);
    expect(markedIds).toEqual(['latency', 'orders-by-status']);
    expect(issuesOf(marked)).toEqual([]);
    const cleared = applyEdit(marked, edit({ markers: null, summary: 'no markers' }));
    expect(cleared.annotations).toEqual([]);
    expect(cleared.panels.some((panel) => panel.view.kind === 'chart' && panel.view.markers)).toBe(
      false,
    );
  });

  test('needs a title for a new dashboard', () => {
    expect(() => applyEdit(undefined, edit({ summary: 'x' }))).toThrow(
      'Give the new dashboard a title.',
    );
  });
});

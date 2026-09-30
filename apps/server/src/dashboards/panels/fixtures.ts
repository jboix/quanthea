/** A first build shared by the panel tests: five panels of data and charts over two connectors. */
import { type DashboardSpec, queryText } from '@querent/shared';
import type { ConnectorLookup } from '../check-queries.ts';
import { validateSpec } from '../validate.ts';
import { applyEdit } from './edit.ts';
import { type EditRequest, editRequestSchema } from './request.ts';

const guardrails = { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 };

/** The test connectors: `prom` speaks PromQL, `shop` SQL. */
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
export function edit(input: unknown): EditRequest {
  return editRequestSchema.parse(input);
}

/**
 * The spec an edit makes, without its chart choices.
 *
 * @param current - The current spec, if any.
 * @param request - The edit.
 * @returns The spec.
 */
export function specOf(current: DashboardSpec | undefined, request: EditRequest): DashboardSpec {
  return applyEdit(current, request).spec;
}

/**
 * The issues the real validation finds in a spec.
 *
 * @param spec - The spec.
 * @returns The issues, as `path: message`.
 */
export function issuesOf(spec: DashboardSpec): string[] {
  const result = validateSpec(spec, { lookup, now: Date.parse('2026-09-29T12:00:00Z') });
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

/**
 * The query text of each panel.
 *
 * @param spec - The spec.
 * @returns One list per panel.
 */
export function queriesOf(spec: DashboardSpec): string[][] {
  return spec.panels.map((panel) => panel.queries.map(queryText));
}

const interval = { kind: 'interval', name: 'interval', options: ['1m', '5m'], default: '5m' };
const service = {
  kind: 'custom',
  name: 'service',
  options: ['checkout', 'cart'],
  default: ['checkout'],
  multi: true,
};

/** A first build: two numbers, two time charts and a ranked bar chart. */
export const firstBuild = edit({
  title: 'Checkout',
  variables: [interval, service],
  panels: [
    {
      title: 'Error rate',
      data: {
        kind: 'ratio',
        connector: 'prom',
        metric: 'http_requests_total',
        filters: [{ field: 'service', op: '=~', value: '$service' }],
        match: [{ field: 'code', op: '=~', value: '5..' }],
        window: '$interval',
      },
      chart: { recipe: 'kpi.stat', variants: ['max'] },
    },
    {
      title: 'Failed orders',
      data: {
        kind: 'sql-stat',
        connector: 'shop',
        table: 'orders',
        time: 'created_at',
        filters: [{ field: 'status', value: 'failed' }],
      },
      chart: { recipe: 'kpi.stat' },
    },
    {
      title: 'Latency',
      data: {
        kind: 'latency',
        connector: 'prom',
        metric: 'http_request_duration_seconds_bucket',
        quantiles: [0.5, 0.95],
        by: ['service'],
      },
      chart: { recipe: 'trend.line', roles: { series: 'quantile' } },
    },
    {
      title: 'Orders by status',
      data: {
        kind: 'sql-series',
        connector: 'shop',
        table: 'orders',
        time: 'created_at',
        by: 'status',
        bucket: '$interval',
        filters: [{ field: 'service', value: '$service' }],
      },
      chart: { recipe: 'trend.line', variants: ['stacked'] },
    },
    {
      title: 'Top codes',
      data: { kind: 'top', connector: 'prom', metric: 'http_requests_total', by: ['code'] },
      chart: { recipe: 'comparison.ranked-bar' },
    },
  ],
  summary: 'first build',
});

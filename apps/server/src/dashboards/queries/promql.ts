/**
 * The PromQL builders: a counter's rate, a ratio such as the error rate, histogram percentiles, a
 * gauge, and the top values by label. A range result becomes a long table: the time, a column per
 * label, a `series` column naming each series, and the `value`.
 */
import type { PanelQuery } from '@querent/shared';
import type { BuiltData } from './built.ts';
import type { DataOf } from './request.ts';
import { byClause, metricName, selector } from './text.ts';

/**
 * A PromQL query, refId A.
 *
 * @param connector - The connector.
 * @param expr - The expression.
 * @param instant - Whether it is evaluated once, at the end of the range.
 * @returns The query.
 */
function promql(connector: string, expr: string, instant = false): PanelQuery {
  return { refId: 'A', connector, language: 'promql', expr, ...(instant ? { instant: true } : {}) };
}

/**
 * The columns of a range result split by labels.
 *
 * @param labels - The labels.
 * @returns The time, the labels in order, the series and the value.
 */
function longColumns(labels: readonly string[]): string[] {
  return ['time', ...[...labels].sort(), 'series', 'value'];
}

/**
 * A counter's per-second rate.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function rateData(request: DataOf<'rate'>): BuiltData {
  const rate = `rate(${selector(request.metric, request.filters)}[${request.window}])`;
  const query = promql(request.connector, `sum${byClause(request.by)} (${rate})`);
  return {
    queries: [query],
    output: {
      shape: 'long',
      columns: longColumns(request.by),
      chart: 'trend.line',
      unit: 'per-second',
    },
  };
}

/**
 * The share of a counter that matches extra filters, such as 5xx over all requests.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function ratioData(request: DataOf<'ratio'>): BuiltData {
  const by = byClause(request.by);
  const part = selector(request.metric, [...request.filters, ...request.match]);
  const whole = selector(request.metric, request.filters);
  const expr = `sum${by} (rate(${part}[${request.window}])) / sum${by} (rate(${whole}[${request.window}]))`;
  return {
    queries: [promql(request.connector, expr)],
    output: {
      shape: 'long',
      columns: longColumns(request.by),
      chart: 'trend.line',
      unit: 'percent',
    },
  };
}

/**
 * A quantile's label, such as `p95`.
 *
 * @param quantile - The quantile, such as 0.95.
 * @returns The label.
 */
function quantileLabel(quantile: number): string {
  return `p${Math.round(quantile * 1000) / 10}`;
}

/**
 * Percentiles of a histogram, in one query: each percentile is a series labelled `quantile`.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function latencyData(request: DataOf<'latency'>): BuiltData {
  const base = metricName(request.metric).replace(/_bucket$/, '');
  const buckets = `rate(${selector(`${base}_bucket`, request.filters)}[${request.window}])`;
  const by = byClause(['le', ...request.by]);
  const expr = request.quantiles
    .map(
      (quantile) =>
        `label_replace(histogram_quantile(${quantile}, sum${by} (${buckets})), "quantile", "${quantileLabel(quantile)}", "", "")`,
    )
    .join(' or ');
  const columns = longColumns(['quantile', ...request.by]);
  return {
    queries: [promql(request.connector, expr)],
    output: { shape: 'long', columns, chart: 'trend.line', unit: 'seconds' },
  };
}

/**
 * A gauge, aggregated.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function gaugeData(request: DataOf<'gauge'>): BuiltData {
  const expr = `${request.aggregate}${byClause(request.by)} (${selector(request.metric, request.filters)})`;
  return {
    queries: [promql(request.connector, expr)],
    output: { shape: 'long', columns: longColumns(request.by), chart: 'trend.line' },
  };
}

/**
 * The top values of a counter over the whole range, by label: one row per value, largest first.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function topData(request: DataOf<'top'>): BuiltData {
  const increase = `increase(${selector(request.metric, request.filters)}[$__range])`;
  const expr = `topk(${request.limit}, sum${byClause(request.by)} (${increase}))`;
  const columns = [...[...request.by].sort(), 'Value'];
  return {
    queries: [promql(request.connector, expr, true)],
    output: { shape: 'long', columns, chart: 'comparison.ranked-bar' },
  };
}

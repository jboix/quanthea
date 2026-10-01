/**
 * The LogQL builders, for Loki: lines or a number from them over time, the share of lines that
 * match, a breakdown by label, one number, and the latest lines. A metric result is long, as in
 * PromQL; values stay quoted and variables stay references the binder escapes.
 */
import type { PanelQuery } from '@quanthea/shared';
import type { BuiltData } from './built.ts';
import type { Filter } from './fields.ts';
import type { LogqlMeasure } from './logql-request.ts';
import type { DataOf } from './request.ts';
import { byClause, promqlMatcher, QueryError, variableOf } from './text.ts';

/** What every LogQL request has: the streams, the line filters, the parser and the filters. */
interface LogRequest {
  /** The stream selector's matchers. */
  readonly stream: readonly Filter[];
  /** The text each line contains. */
  readonly contains: readonly string[];
  /** The parser of the lines' fields, if any. */
  readonly parser?: 'json' | 'logfmt' | undefined;
  /** Filters on labels and fields. */
  readonly filters: readonly Filter[];
}

/** The measures read from a field with `unwrap`, and their range function. */
const unwrapped: Readonly<Record<string, string>> = {
  sum: 'sum_over_time',
  avg: 'avg_over_time',
  min: 'min_over_time',
  max: 'max_over_time',
  quantile: 'quantile_over_time',
};

/**
 * A LogQL query, refId A.
 *
 * @param connector - The connector.
 * @param expr - The expression.
 * @param instant - Whether it is evaluated once, at the end of the range.
 * @returns The query.
 */
function logql(connector: string, expr: string, instant = false): PanelQuery {
  return { refId: 'A', connector, language: 'logql', expr, ...(instant ? { instant: true } : {}) };
}

/**
 * A line filter: the text the line must contain.
 *
 * @param text - A literal, or a variable such as `$text`.
 * @returns Such as `|= "timeout"`.
 */
function lineFilter(text: string): string {
  return `|= ${variableOf(text) ? `"${text}"` : JSON.stringify(text)}`;
}

/**
 * The log query of a request: the stream selector, the line filters, the parser, then the label
 * and field filters, these and `extra`.
 *
 * @param request - The request.
 * @param extra - More filters, such as a ratio's part.
 * @returns Such as `{service="checkout-svc"} |= "timeout" | json | status="500"`.
 */
function logQuery(request: LogRequest, extra: readonly Filter[] = []): string {
  const parts = [
    `{${request.stream.map(promqlMatcher).join(',')}}`,
    ...request.contains.map(lineFilter),
    ...(request.parser ? [`| ${request.parser}`] : []),
    ...[...request.filters, ...extra].map((filter) => `| ${promqlMatcher(filter)}`),
  ];
  return parts.join(' ');
}

/**
 * A measure over a window, aggregated by labels: line counts and rates summed, numbers from a
 * field read with `unwrap` and grouped in the range function.
 *
 * @param logs - The log query.
 * @param measure - The measure.
 * @param by - The labels.
 * @param window - The window, such as `$__interval` or `$__range`.
 * @returns The expression.
 * @throws {QueryError} When a measure of a field names no field.
 */
function measureExpr(
  logs: string,
  measure: LogqlMeasure,
  by: readonly string[],
  window: string,
): string {
  if (measure.fn === 'count' || measure.fn === 'rate') {
    const range = measure.fn === 'count' ? 'count_over_time' : 'rate';
    return `sum${byClause(by)} (${range}(${logs} [${window}]))`;
  }
  if (!measure.field) throw new QueryError(`${measure.fn} needs a field to unwrap.`);
  const quantile = measure.fn === 'quantile' ? `${measure.quantile ?? 0.95}, ` : '';
  const source = `${logs} | unwrap ${measure.field} | __error__="" [${window}]`;
  return `${unwrapped[measure.fn]}(${quantile}${source}) by (${by.join(', ')})`;
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
 * Lines, or a number from them, over time.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function logqlSeriesData(request: DataOf<'logql-series'>): BuiltData {
  const expr = measureExpr(logQuery(request), request.measure, request.by, request.window);
  const rate = request.measure.fn === 'rate';
  return {
    queries: [logql(request.connector, expr)],
    output: {
      shape: 'long',
      columns: longColumns(request.by),
      chart: 'trend.line',
      ...(rate ? { unit: 'per-second' as const } : {}),
    },
  };
}

/**
 * The share of the lines that also match `match`: over time, a long result; over the range, one
 * value per value of the `by` labels, or one value.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function logqlRatioData(request: DataOf<'logql-ratio'>): BuiltData {
  const range = request.over === 'range';
  const window = range ? '$__range' : request.window;
  const count = { fn: 'count' } as const;
  const part = measureExpr(logQuery(request, request.match), count, request.by, window);
  const whole = measureExpr(logQuery(request), count, request.by, window);
  const share = `${part} / ${whole}`;
  const expr = request.complement ? `1 - (${share})` : share;
  const output = range
    ? {
        shape: request.by.length > 0 ? ('long' as const) : ('single' as const),
        columns: [...[...request.by].sort(), 'Value'],
        chart: request.by.length > 0 ? 'comparison.bar' : 'kpi.stat',
      }
    : { shape: 'long' as const, columns: longColumns(request.by), chart: 'trend.line' };
  return {
    queries: [logql(request.connector, expr, range)],
    output: { ...output, unit: 'percent' },
  };
}

/**
 * Lines, or a number from them, over the range by label, largest first.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function logqlBreakdownData(request: DataOf<'logql-breakdown'>): BuiltData {
  const measure = measureExpr(logQuery(request), request.measure, request.by, '$__range');
  return {
    queries: [logql(request.connector, `topk(${request.limit}, ${measure})`, true)],
    output: {
      shape: 'long',
      columns: [...[...request.by].sort(), 'Value'],
      chart: 'comparison.ranked-bar',
    },
  };
}

/**
 * One number over the range.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function logqlStatData(request: DataOf<'logql-stat'>): BuiltData {
  const expr = measureExpr(logQuery(request), request.measure, [], '$__range');
  return {
    queries: [logql(request.connector, expr, true)],
    output: { shape: 'single', columns: ['Value'], chart: 'kpi.stat' },
  };
}

/**
 * The latest lines, newest first: their time, the line, and a column per label.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function logqlLinesData(request: DataOf<'logql-lines'>): BuiltData {
  return {
    queries: [logql(request.connector, logQuery(request))],
    output: { shape: 'rows', columns: ['time', 'line'], chart: 'table.rows' },
  };
}

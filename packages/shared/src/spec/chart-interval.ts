/**
 * The intervals a time chart of a report or an alert is cut into: a closed list, and the one a
 * period takes when nobody chose. The browser sends one of these names, never a duration of its
 * own, and the server binds it.
 */
import { z } from 'zod';
import { durationMs } from './alert.ts';
import type { QueryTemplate } from './queries.ts';

/** The intervals a chart may be cut into, finest first. */
export const chartIntervals = ['1m', '5m', '10m', '30m', '1h', '6h', '1d'] as const;

/** Validates an interval of the list. */
export const chartIntervalSchema = z.enum(chartIntervals);

/** An interval of the list. */
export type ChartInterval = z.infer<typeof chartIntervalSchema>;

/** The longest period each interval is the default for, in milliseconds, finest first. */
const defaultUpTo: readonly (readonly [ChartInterval, number])[] = [
  ['1m', 2 * 3_600_000],
  ['5m', 12 * 3_600_000],
  ['10m', 36 * 3_600_000],
  ['30m', 4 * 86_400_000],
  ['1h', 14 * 86_400_000],
  ['6h', 27 * 86_400_000],
];

/** The most pieces a chosen interval may cut a period into. */
export const maxChartPieces = 1500;

/**
 * The interval a period is cut into when nobody chose: a day by 10 minutes, a week by the hour, a
 * month by the day.
 *
 * @param periodMs - The length of the period shown, in milliseconds.
 * @returns The interval.
 */
export function defaultChartInterval(periodMs: number): ChartInterval {
  return defaultUpTo.find(([, upTo]) => periodMs <= upTo)?.[0] ?? '1d';
}

/**
 * The intervals a person may choose for a period: those that cut it into at least two pieces and
 * at most {@link maxChartPieces}, and are no finer than the data comes.
 *
 * @param periodMs - The length of the period shown, in milliseconds.
 * @param atLeastMs - The finest interval that makes sense, such as an alert's `every`.
 * @returns The intervals, finest first.
 */
export function chartIntervalChoices(periodMs: number, atLeastMs = 0): ChartInterval[] {
  return chartIntervals.filter((interval) => {
    const width = durationMs(interval);
    return width >= atLeastMs && periodMs / width >= 2 && periodMs / width <= maxChartPieces;
  });
}

/**
 * Whether an interval may be chosen for a period.
 *
 * @param interval - The interval.
 * @param periodMs - The length of the period shown, in milliseconds.
 * @returns `true` when it is one of the period's choices.
 */
export function fitsPeriod(interval: ChartInterval, periodMs: number): boolean {
  return chartIntervalChoices(periodMs).includes(interval);
}

/** The built-ins a query cuts its time buckets with, in any query language. */
const intervalBuiltIns = /__(?:rate_interval|interval_ms|interval_s|interval)\b/;

/** The built-ins a PromQL or LogQL expression follows its step with, outside strings. */
const stepBuiltIns = /\$\{?__(?:rate_)?interval\b/;

/**
 * An expression without its quoted strings, which never hold a built-in.
 *
 * @param expr - A PromQL or LogQL expression.
 * @returns The expression with each string emptied.
 */
function withoutStrings(expr: string): string {
  return expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '""');
}

/**
 * Whether a query is cut again when another interval is chosen. A PromQL or LogQL range query is
 * when its windows follow the step, `[$__interval]` or `[$__rate_interval]`: one with a window
 * written out keeps its own step. Any other query is when it names the interval built-in of its
 * language: `:__interval` or `:__interval_s` in SQL, `__interval` in a search, `__interval_ms` in
 * MongoDB.
 *
 * @param query - The query.
 * @returns `true` when a chosen interval changes its result.
 */
export function followsChartInterval(query: QueryTemplate): boolean {
  if (query.language === 'promql' || query.language === 'logql')
    return query.instant !== true && stepBuiltIns.test(withoutStrings(query.expr));
  const { connector: _connector, ...written } = query;
  return intervalBuiltIns.test(JSON.stringify(written));
}

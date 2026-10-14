/**
 * Replaces an interval variable's `auto` with a duration before any query binds it, so the
 * binders only ever see durations.
 */
import { autoInterval, type DashboardSpec } from '@quanthea/shared';
import { sqlIntervalWithin } from '../query/interval.ts';
import type { Variables } from '../query/variables.ts';

/** The points a chart is assumed to have room for when its width is not known. */
const usualPoints = 300;

/**
 * The variables with each `auto` interval replaced by the duration that suits the time range and
 * the chart: the usual one for the range, or a coarser one when the chart has room for fewer
 * points.
 *
 * @param spec - The spec, for which variables are intervals.
 * @param variables - The resolved variables.
 * @param timeRange - The time range of the run.
 * @param chartPoints - The most points the chart can show, when it is known.
 * @param chosen - The interval the caller cuts its charts into, such as a report's; `auto` takes it.
 * @returns The variables, the same object when none is `auto`.
 */
export function withAutoIntervals(
  spec: DashboardSpec,
  variables: Variables,
  timeRange: { readonly from: Date; readonly to: Date },
  chartPoints?: number,
  chosen?: string,
): Variables {
  const autos = spec.variables.filter(
    (variable) => variable.kind === 'interval' && variables[variable.name]?.value === autoInterval,
  );
  if (autos.length === 0) return variables;
  const value = chosen ?? sqlIntervalWithin(timeRange, chartPoints ?? usualPoints);
  const bound = autos.map((variable) => [variable.name, { value, duration: true }] as const);
  return { ...variables, ...Object.fromEntries(bound) };
}

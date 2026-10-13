/**
 * The step of a PromQL or LogQL range query. A query keeps the step it wrote, raised only so the
 * range fits the point limit. A chosen interval, or the points a chart can show, moves the step
 * only of an expression whose windows follow it (`$__interval`, `$__rate_interval`): a window
 * written out, such as `[1m]`, read at a wider step would skip the data between two points.
 */

import type { TimeRange } from '../connectors/_shared/index.ts';
import { chosenSeconds, parseDuration } from './interval.ts';
import { QueryError } from './query-error.ts';
import { type Variables, valuesOf } from './variables.ts';

/** A template's step, as it is written. */
interface Stepped {
  /** The step: a duration, or `$name` of an interval variable. */
  readonly step?: string | undefined;
}

/** What binding an expression depends on beyond the template and the variables. */
export interface ExpressionRun {
  /** The time range, for `$__range`. */
  readonly timeRange: TimeRange;
  /** The most points one series may have, whatever the expression: the step is raised to fit. */
  readonly maxPoints: number;
  /** The interval the charts are cut into, when one was chosen. */
  readonly interval?: string | undefined;
  /** The most points the chart can show, when it is a time chart and no interval was chosen. */
  readonly chartPoints?: number | undefined;
}

/** A PromQL duration, the only text an interval variable may put into code. */
const durationPattern = /^\d{1,5}[smhd]$/;

/**
 * The duration an interval variable binds to, checked again here so nothing else reaches the code.
 *
 * @param name - The variable name.
 * @param variables - The variables.
 * @returns The duration, or `undefined` when the name is not an interval variable.
 */
export function intervalValue(name: string, variables: Variables): string | undefined {
  const binding = variables[name];
  if (!binding?.duration) return undefined;
  const [value] = valuesOf(binding);
  return value !== undefined && durationPattern.test(value) ? value : undefined;
}

/** The built-in durations that follow the step, bare or in braces. */
const stepBuiltIn = /\$\{?__(?:rate_)?interval\b/;

/**
 * Whether the windows of an expression follow its step.
 *
 * @param code - The expression's code, without its strings and comments.
 * @returns `true` when it names `$__interval` or `$__rate_interval`.
 */
export function followsStep(code: string): boolean {
  return stepBuiltIn.test(code);
}

/**
 * A template's step, with an interval variable replaced by its duration.
 *
 * @param step - The step: a duration, or `$name` of an interval variable.
 * @param variables - The variables.
 * @returns The duration.
 * @throws {QueryError} `invalid` for a variable that is not an interval variable.
 */
function bindStep(step: string, variables: Variables): string {
  const match = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))$/.exec(step);
  if (!match) return step;
  const duration = intervalValue(match[1] ?? match[2] ?? '', variables);
  if (duration === undefined)
    throw new QueryError('invalid', 'The step takes a duration or an interval variable.');
  return duration;
}

/**
 * The step between points: the chosen interval, else the template's step, raised so the range
 * fits in `maxPoints`.
 *
 * @param template - The template.
 * @param timeRange - The time range.
 * @param maxPoints - The most points one series may have.
 * @param interval - The interval the charts are cut into, when one was chosen, such as `1h`.
 * @returns The step in seconds.
 * @throws {QueryError} `invalid` when the step is not a duration such as `15s`.
 */
export function stepFor(
  template: Stepped,
  timeRange: TimeRange,
  maxPoints: number,
  interval?: string,
): number {
  const own = template.step === undefined ? 15 : parseDuration(template.step);
  const minimum = chosenSeconds(interval) ?? own;
  if (minimum === undefined || minimum === 0)
    throw new QueryError('invalid', 'The step is a duration such as 15s, 1m or 1h.');
  const rangeSeconds = (timeRange.to.getTime() - timeRange.from.getTime()) / 1000;
  return Math.max(minimum, Math.ceil(rangeSeconds / maxPoints));
}

/**
 * The step an expression is bound with.
 *
 * @param template - The template.
 * @param variables - The variables, for a step that names an interval variable.
 * @param run - The time range, the point limit, the chosen interval and the chart's points.
 * @param code - The expression's code, without its strings and comments.
 * @returns The step in seconds: the chosen interval or one that fits the chart when the
 *   expression follows its step, else the step it wrote, raised to fit the point limit.
 * @throws {QueryError} `invalid` for a step or an interval that is not a duration.
 */
export function stepOf(
  template: Stepped,
  variables: Variables,
  run: ExpressionRun,
  code: string,
): number {
  const step = template.step === undefined ? undefined : bindStep(template.step, variables);
  const written = { ...template, step };
  chosenSeconds(run.interval);
  if (!followsStep(code)) return stepFor(written, run.timeRange, run.maxPoints);
  const room = Math.max(1, Math.min(run.maxPoints, run.chartPoints ?? run.maxPoints));
  return stepFor(written, run.timeRange, room, run.interval);
}

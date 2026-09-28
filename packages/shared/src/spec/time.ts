/**
 * Time in a dashboard: the default range of the built-in time variable, written as `now`,
 * `now-7d` or an ISO 8601 timestamp, and its resolution to absolute instants.
 */
import { z } from 'zod';

/** A relative time: `now`, or `now-` followed by an amount and a unit. */
const relativePattern = /^now(?:-(\d{1,5})([smhdwMy]))?$/;

/** Milliseconds per fixed-length unit. Months and years follow the calendar instead. */
const unitMilliseconds: Readonly<Record<string, number>> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Validates a time expression: `now`, `now-15m`, `now-7d`, or an ISO 8601 timestamp. */
export const timeExpressionSchema = z.union([
  z.string().regex(relativePattern, 'Use now, now-15m, now-7d… or an ISO 8601 timestamp.'),
  z.iso.datetime({ offset: true }),
]);

/** Validates a time range as expressions, such as `{ from: 'now-6h', to: 'now' }`. */
export const timeRangeSchema = z.strictObject({
  from: timeExpressionSchema,
  to: timeExpressionSchema,
});

/** A time range as expressions. */
export type TimeRangeExpression = z.infer<typeof timeRangeSchema>;

/** A time range as instants, in Unix epoch milliseconds. */
export interface ResolvedTimeRange {
  /** The start. */
  readonly from: number;
  /** The end. */
  readonly to: number;
}

/**
 * Subtracts an amount of a unit from an instant. Months and years move the calendar date in UTC.
 *
 * @param now - The instant, in epoch milliseconds.
 * @param amount - How many units.
 * @param unit - `s`, `m`, `h`, `d`, `w`, `M` (months) or `y` (years).
 * @returns The earlier instant.
 */
function subtract(now: number, amount: number, unit: string): number {
  const fixed = unitMilliseconds[unit];
  if (fixed !== undefined) return now - amount * fixed;
  const date = new Date(now);
  if (unit === 'M') date.setUTCMonth(date.getUTCMonth() - amount);
  else date.setUTCFullYear(date.getUTCFullYear() - amount);
  return date.getTime();
}

/**
 * Resolves one time expression.
 *
 * @param expression - `now`, `now-7d`, or an ISO 8601 timestamp.
 * @param now - The current instant, in epoch milliseconds.
 * @returns The instant, in epoch milliseconds, or `NaN` when the expression is not valid.
 */
export function resolveTime(expression: string, now: number): number {
  const relative = relativePattern.exec(expression);
  if (!relative) return Date.parse(expression);
  const [, amount, unit] = relative;
  return amount === undefined || unit === undefined ? now : subtract(now, Number(amount), unit);
}

/**
 * Resolves a time range.
 *
 * @param range - The range as expressions.
 * @param now - The current instant, in epoch milliseconds.
 * @returns The range as instants. `from` may be after `to`; callers check.
 */
export function resolveTimeRange(range: TimeRangeExpression, now: number): ResolvedTimeRange {
  return { from: resolveTime(range.from, now), to: resolveTime(range.to, now) };
}

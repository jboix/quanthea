/**
 * The band a series' recent history gives: the mean and the standard deviation of its points over
 * a baseline. The evaluator reads one baseline from the points of its history query, the replay
 * one per step from the points of its whole window, both through the same sums, so they agree.
 */
import type { SeriesPoint } from './series.ts';

/** What a baseline says of a series. */
export interface Baseline {
  /** The mean of its points. */
  readonly mean: number;
  /** Their standard deviation, over all of them (the population's). */
  readonly deviation: number;
}

/** The fewest points a baseline is learned from. */
export const minBaselinePoints = 10;

/** The share of the baseline's length its points must span. */
const minBaselineSpan = 0.5;

/** A point with a time. */
type TimedPoint = SeriesPoint & { readonly at: number };

/**
 * The running sums of the points, each value counted from the mean of them all so that large
 * values of a small spread keep their digits.
 *
 * @param points - The points, in time order.
 * @returns The centre, and the sums of the distances and of their squares before each point.
 */
function runningSums(points: readonly TimedPoint[]) {
  const centre = points.reduce((total, point) => total + point.value, 0) / (points.length || 1);
  const sums = [0];
  const squares = [0];
  for (const point of points) {
    const distance = point.value - centre;
    sums.push((sums.at(-1) ?? 0) + distance);
    squares.push((squares.at(-1) ?? 0) + distance * distance);
  }
  return { centre, sums, squares };
}

/**
 * The first point at or after an instant, or the first one after it.
 *
 * @param points - The points, in time order.
 * @param instant - The instant.
 * @param after - Whether a point at the instant itself is passed over.
 * @returns Its index; the number of points when none is that late.
 */
function firstFrom(points: readonly TimedPoint[], instant: number, after: boolean): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const at = points[middle]?.at ?? 0;
    if (at < instant || (after && at === instant)) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * What a running sum added between two points.
 *
 * @param sums - The sums before each point, and after the last.
 * @param start - The first point counted.
 * @param end - The point after the last one counted.
 * @returns The sum over those points.
 */
function added(sums: readonly number[], start: number, end: number): number {
  return (sums[end] ?? 0) - (sums[start] ?? 0);
}

/**
 * How long the points from one to another span.
 *
 * @param points - The points, in time order.
 * @param start - The first point.
 * @param end - The point after the last.
 * @returns The time from the first to the last, in milliseconds.
 */
function spanOf(points: readonly TimedPoint[], start: number, end: number): number {
  return (points[end - 1]?.at ?? 0) - (points[start]?.at ?? 0);
}

/**
 * A reader of the baselines of one series.
 *
 * @param points - The points of the series; those without a time are left out.
 * @returns A function from a span of time, both ends included as a query returns them, and the
 *   length the baseline should have, to the mean and deviation of the points in it, or `null` with
 *   too little history: fewer than {@link minBaselinePoints} points, or points that span less than
 *   half that length.
 */
export function baselineReader(
  points: readonly SeriesPoint[],
): (from: number, to: number, lengthMs: number) => Baseline | null {
  const timed = points.filter((point): point is TimedPoint => point.at !== null);
  const sorted = timed.sort((first, second) => first.at - second.at);
  const { centre, sums, squares } = runningSums(sorted);
  return (from, to, lengthMs) => {
    const start = firstFrom(sorted, from, false);
    const end = firstFrom(sorted, to, true);
    const count = end - start;
    if (count < minBaselinePoints) return null;
    if (spanOf(sorted, start, end) < lengthMs * minBaselineSpan) return null;
    const offset = added(sums, start, end) / count;
    const variance = added(squares, start, end) / count - offset * offset;
    return { mean: centre + offset, deviation: Math.sqrt(Math.max(0, variance)) };
  };
}

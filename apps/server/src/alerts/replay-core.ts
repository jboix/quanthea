/**
 * Replays an alert over past points: at each step it reads the window that evaluation would have
 * queried, feeds the state machine in time order, and reports when each series would have fired,
 * and when the condition held but not long enough to fire. Pure.
 */
import {
  type AlertSpec,
  durationMs,
  type Observation,
  type ReplayTrack,
  replayRule,
  type StateRule,
  thresholdHolds,
  trackSeries,
} from '@quanthea/shared';
import { wholeAlertKey } from './observe.ts';
import { type ObservedSeries, reducePoints, type SeriesPoint } from './series.ts';

/** How one series would have behaved, with its key and labels. */
export interface ReplayedSeries extends ReplayTrack {
  /** The series key. */
  readonly key: string;
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
}

/** The evaluations of a replay. */
export interface ReplayWindow {
  /** The first evaluation, in epoch milliseconds. */
  readonly from: number;
  /** The last one at most. */
  readonly to: number;
  /** The time between evaluations. */
  readonly stepMs: number;
}

/**
 * The timing rule of a spec, for the state machine.
 *
 * @param spec - The spec.
 * @returns How long the condition holds before firing, and the grace of a missing series.
 */
export function ruleOf(spec: AlertSpec): StateRule {
  return replayRule(spec.condition.for, spec.every);
}

/**
 * The instants of the evaluations.
 *
 * @param window - The window.
 * @returns The instants, from the start, a step apart.
 */
function evaluationTimes(window: ReplayWindow): number[] {
  const times: number[] = [];
  for (let at = window.from; at <= window.to; at += window.stepMs) times.push(at);
  return times;
}

/**
 * A reader of the points within the window of each evaluation, as the times move forwards.
 *
 * @param points - The points of a series.
 * @param windowMs - The length of each evaluation's window.
 * @returns A function from an evaluation time to the points in `(at - windowMs, at]`.
 */
function slidingWindow(points: readonly SeriesPoint[], windowMs: number) {
  const sorted = [...points].sort((first, second) => (first.at ?? 0) - (second.at ?? 0));
  let start = 0;
  let end = 0;
  return (at: number): readonly SeriesPoint[] => {
    while (end < sorted.length && (sorted[end]?.at ?? 0) <= at) end += 1;
    while (start < end && (sorted[start]?.at ?? 0) <= at - windowMs) start += 1;
    return sorted.slice(start, end);
  };
}

/**
 * Runs the state machine over the evaluations of one series of a spec.
 *
 * @param spec - The spec.
 * @param window - The evaluations.
 * @param observeAt - What each evaluation observes.
 * @returns How the series would have behaved.
 */
function track(spec: AlertSpec, window: ReplayWindow, observeAt: (at: number) => Observation) {
  const { condition } = spec;
  return trackSeries({
    rule: ruleOf(spec),
    direction: condition.kind === 'threshold' ? condition.op : undefined,
    times: evaluationTimes(window),
    observeAt,
    end: window.to,
  });
}

/**
 * Replays a spec over the series of a past result.
 *
 * @param spec - The spec.
 * @param series - The series of the query over the whole window, with times.
 * @param window - The evaluations.
 * @returns How each series would have behaved; one series for the alert as a whole under a
 *   `no_data` condition.
 */
export function replaySeries(
  spec: AlertSpec,
  series: readonly ObservedSeries[],
  window: ReplayWindow,
): ReplayedSeries[] {
  const windowMs = Math.max(durationMs(spec.lookback), window.stepMs);
  const readers = series.map((each) => slidingWindow(each.points, windowMs));
  const { condition } = spec;
  if (condition.kind === 'no_data') {
    const observeAt = (at: number): Observation => {
      const holds = readers.every((read) => read(at).length === 0);
      return { kind: 'value', value: null, holds };
    };
    return [{ key: wholeAlertKey, labels: {}, ...track(spec, window, observeAt) }];
  }
  return series.map((each, index) => {
    const read = readers[index] ?? (() => []);
    const observeAt = (at: number): Observation => {
      const points = read(at);
      if (points.length === 0) return { kind: 'missing' };
      const value = reducePoints(points, spec.value.reduce);
      return { kind: 'value', value, holds: thresholdHolds(condition, value) };
    };
    return { key: each.key, labels: each.labels, ...track(spec, window, observeAt) };
  });
}

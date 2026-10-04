/**
 * Replays an alert over past points: at each step it reads the window that evaluation would have
 * queried, feeds the state machine in time order, and reports when each series would have fired,
 * and when the condition held but not long enough to fire. Pure.
 */
import { type AlertSpec, durationMs } from '@quanthea/shared';
import { thresholdHolds, wholeAlertKey } from './observe.ts';
import { type ObservedSeries, reducePoints, type SeriesPoint } from './series.ts';
import {
  type Observation,
  type SeriesState,
  type StateRule,
  stepSeries,
  type Transition,
} from './state.ts';

/** A period when a series fired. */
export interface FiringPeriod {
  /** When it started firing. */
  readonly from: number;
  /** When it stopped, or the end of the window. */
  readonly to: number;
  /** Whether it still fired at the end of the window. */
  readonly ongoing: boolean;
}

/** A period when the condition held, but not for long enough to fire. */
export interface ShortSpike {
  /** When it started holding. */
  readonly from: number;
  /** When it stopped. */
  readonly to: number;
  /** The extreme value meanwhile: the highest above a threshold, the lowest below one. */
  readonly peak: number | null;
}

/** How one series would have behaved. */
export interface ReplayedSeries {
  /** The series key. */
  readonly key: string;
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** The value at each evaluation. */
  readonly points: { at: number; value: number | null }[];
  /** When it fired. */
  readonly firing: FiringPeriod[];
  /** How many times it started firing. */
  readonly firings: number;
  /** How long it fired in all, in milliseconds. */
  readonly firingMs: number;
  /** When the condition held too briefly to fire. */
  readonly tooShort: ShortSpike[];
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

/** How many evaluations a series may stay out of the result before it resolves. */
const graceEvaluations = 3;

/**
 * The timing rule of a spec, for the state machine.
 *
 * @param spec - The spec.
 * @returns How long the condition holds before firing, and the grace of a missing series.
 */
export function ruleOf(spec: AlertSpec): StateRule {
  return {
    forMs: durationMs(spec.condition.for),
    graceMs: graceEvaluations * durationMs(spec.every),
  };
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

/** What a replayed series collects as it goes. */
interface Tracker {
  /** The value at each evaluation. */
  readonly points: { at: number; value: number | null }[];
  /** The periods of firing. */
  readonly firing: FiringPeriod[];
  /** The spikes too short to fire. */
  readonly tooShort: ShortSpike[];
  /** The start of the current pending period, and its extreme value. */
  pending: { from: number; peak: number | null } | null;
}

/**
 * The more extreme of two values, in the direction of the condition.
 *
 * @param spec - The spec.
 * @param first - One value.
 * @param second - The other.
 * @returns The highest above a threshold, the lowest below one.
 */
function extreme(spec: AlertSpec, first: number | null, second: number | null): number | null {
  if (first === null || second === null) return first ?? second;
  const below = spec.condition.kind === 'threshold' && spec.condition.op === 'below';
  return below ? Math.min(first, second) : Math.max(first, second);
}

/**
 * Records a change of state.
 *
 * @param tracker - The series' tracker.
 * @param transition - The change.
 */
function record(tracker: Tracker, transition: Transition): void {
  if (transition.from === 'firing') {
    const open = tracker.firing.pop();
    if (open) tracker.firing.push({ ...open, to: transition.at, ongoing: false });
  }
  if (transition.to === 'firing')
    tracker.firing.push({ from: transition.at, to: transition.at, ongoing: true });
  if (transition.from === 'pending' && transition.to === 'ok' && tracker.pending)
    tracker.tooShort.push({ ...tracker.pending, to: transition.at });
  if (transition.to === 'pending')
    tracker.pending = { from: transition.at, peak: transition.value };
  else tracker.pending = null;
}

/**
 * Runs the state machine over the evaluations of one series.
 *
 * @param spec - The spec.
 * @param times - The evaluation times.
 * @param observeAt - What each evaluation observes.
 * @returns The tracker after the last evaluation.
 */
function runSeries(
  spec: AlertSpec,
  times: readonly number[],
  observeAt: (at: number) => Observation,
): Tracker {
  const rule = ruleOf(spec);
  const tracker: Tracker = { points: [], firing: [], tooShort: [], pending: null };
  let state: SeriesState | undefined;
  for (const at of times) {
    const observation = observeAt(at);
    const value = observation.kind === 'value' ? observation.value : null;
    tracker.points.push({ at, value });
    const step = stepSeries(state, observation, rule, at);
    if (step.transition) record(tracker, step.transition);
    else if (tracker.pending) tracker.pending.peak = extreme(spec, tracker.pending.peak, value);
    state = step.next ?? undefined;
  }
  return tracker;
}

/**
 * Summarizes a tracker.
 *
 * @param series - The series key and labels.
 * @param tracker - Its tracker.
 * @param end - The end of the window, where an ongoing firing stops counting.
 * @returns The replayed series.
 */
function summarize(
  series: Pick<ObservedSeries, 'key' | 'labels'>,
  tracker: Tracker,
  end: number,
): ReplayedSeries {
  const firing = tracker.firing.map((period) => (period.ongoing ? { ...period, to: end } : period));
  const firingMs = firing.reduce((total, period) => total + period.to - period.from, 0);
  const { points, tooShort } = tracker;
  return { ...series, points, firing, firings: firing.length, firingMs, tooShort };
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
  const times = evaluationTimes(window);
  const windowMs = Math.max(durationMs(spec.lookback), window.stepMs);
  const readers = series.map((each) => slidingWindow(each.points, windowMs));
  const { condition } = spec;
  if (condition.kind === 'no_data') {
    const observeAt = (at: number): Observation => {
      const holds = readers.every((read) => read(at).length === 0);
      return { kind: 'value', value: null, holds };
    };
    const tracker = runSeries(spec, times, observeAt);
    return [summarize({ key: wholeAlertKey, labels: {} }, tracker, window.to)];
  }
  return series.map((each, index) => {
    const read = readers[index] ?? (() => []);
    const observeAt = (at: number): Observation => {
      const points = read(at);
      if (points.length === 0) return { kind: 'missing' };
      const value = reducePoints(points, spec.value.reduce);
      return { kind: 'value', value, holds: thresholdHolds(condition, value) };
    };
    return summarize(each, runSeries(spec, times, observeAt), window.to);
  });
}

/**
 * The core of a replay, shared by the server and the browser: feed the state machine one
 * observation per evaluation, in time order, and collect when a series fired and when the
 * condition held too briefly to fire. The server reads each evaluation's window from the query's
 * points; the browser replays the values the server returned at another threshold, while a person
 * drags it, with the same rules. Pure.
 */
import { durationMs } from '../spec/alert.ts';
import {
  type Observation,
  type SeriesState,
  type StateRule,
  stepSeries,
  type Transition,
} from './state-machine.ts';

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

/** A value at one evaluation; `null` when the evaluation saw no value. */
export interface ReplayPoint {
  /** The evaluation, in epoch milliseconds. */
  readonly at: number;
  /** The value. */
  readonly value: number | null;
}

/** How one series would have behaved. */
export interface ReplayTrack {
  /** The value at each evaluation. */
  readonly points: ReplayPoint[];
  /** When it fired. */
  readonly firing: FiringPeriod[];
  /** How many times it started firing. */
  readonly firings: number;
  /** How long it fired in all, in milliseconds. */
  readonly firingMs: number;
  /** When the condition held too briefly to fire. */
  readonly tooShort: ShortSpike[];
}

/** Which way a threshold points, for the peak of a spike; `undefined` for no threshold. */
export type ThresholdDirection = 'above' | 'below' | undefined;

/** A threshold condition, as the replay reads it. */
export interface ReplayThreshold {
  /** Above or below. */
  readonly op: 'above' | 'below';
  /** The threshold. */
  readonly value: number;
  /** How long it holds before firing, such as `5m`. */
  readonly for: string;
}

/** How many evaluations a series may stay out of the result before it resolves. */
const graceEvaluations = 3;

/**
 * The timing rule of an alert, for the state machine.
 *
 * @param holdFor - How long the condition holds before firing, such as `5m`.
 * @param every - How often the alert is evaluated, such as `1m`.
 * @returns How long the condition holds before firing, and the grace of a missing series.
 */
export function replayRule(holdFor: string, every: string): StateRule {
  return { forMs: durationMs(holdFor), graceMs: graceEvaluations * durationMs(every) };
}

/**
 * Whether a threshold holds for a value.
 *
 * @param threshold - The operator and the threshold.
 * @param value - The value, if any.
 * @returns `true` when the value is strictly past the threshold.
 */
export function thresholdHolds(
  threshold: Pick<ReplayThreshold, 'op' | 'value'>,
  value: number | null,
): boolean {
  if (value === null) return false;
  return threshold.op === 'above' ? value > threshold.value : value < threshold.value;
}

/** What a replayed series collects as it goes. */
interface Tracker {
  /** The value at each evaluation. */
  readonly points: ReplayPoint[];
  /** The periods of firing. */
  readonly firing: FiringPeriod[];
  /** The spikes too short to fire. */
  readonly tooShort: ShortSpike[];
  /** The start of the current pending period, and its extreme value. */
  pending: { from: number; peak: number | null } | null;
}

/**
 * The more extreme of two values, in the direction of the threshold.
 *
 * @param direction - Above or below; above when there is no threshold.
 * @param first - One value.
 * @param second - The other.
 * @returns The highest above a threshold, the lowest below one.
 */
function extreme(
  direction: ThresholdDirection,
  first: number | null,
  second: number | null,
): number | null {
  if (first === null || second === null) return first ?? second;
  return direction === 'below' ? Math.min(first, second) : Math.max(first, second);
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
 * Summarizes a tracker.
 *
 * @param tracker - The tracker after the last evaluation.
 * @param end - The end of the window, where an ongoing firing stops counting.
 * @returns The track.
 */
function summarize(tracker: Tracker, end: number): ReplayTrack {
  const firing = tracker.firing.map((period) => (period.ongoing ? { ...period, to: end } : period));
  const firingMs = firing.reduce((total, period) => total + period.to - period.from, 0);
  const { points, tooShort } = tracker;
  return { points, firing, firings: firing.length, firingMs, tooShort };
}

/** What a replay of one series runs on. */
export interface ReplayRun {
  /** The timing rule. */
  readonly rule: StateRule;
  /** Which way the threshold points, for the peaks. */
  readonly direction: ThresholdDirection;
  /** The evaluation times, in order. */
  readonly times: readonly number[];
  /** What each evaluation observes. */
  readonly observeAt: (at: number) => Observation;
  /** The end of the window. */
  readonly end: number;
}

/**
 * Runs the state machine over the evaluations of one series.
 *
 * @param run - The rule, the direction, the times, the observations and the end.
 * @returns How the series would have behaved.
 */
export function trackSeries(run: ReplayRun): ReplayTrack {
  const tracker: Tracker = { points: [], firing: [], tooShort: [], pending: null };
  let state: SeriesState | undefined;
  for (const at of run.times) {
    const observation = run.observeAt(at);
    const value = observation.kind === 'value' ? observation.value : null;
    tracker.points.push({ at, value });
    const step = stepSeries(state, observation, run.rule, at);
    if (step.transition) record(tracker, step.transition);
    else if (tracker.pending)
      tracker.pending.peak = extreme(run.direction, tracker.pending.peak, value);
    state = step.next ?? undefined;
  }
  return summarize(tracker, run.end);
}

/**
 * Replays the values of one series at another threshold, as the server would have: each point
 * is an evaluation, and a point without a value is a series the result left out.
 *
 * @param points - The value at each evaluation, from a replay.
 * @param threshold - The threshold to replay at.
 * @param every - How often the alert is evaluated, for the grace of a missing series.
 * @param end - The end of the replay's window.
 * @returns How the series would have behaved.
 */
export function replayAtThreshold(
  points: readonly ReplayPoint[],
  threshold: ReplayThreshold,
  every: string,
  end: number,
): ReplayTrack {
  const values = new Map(points.map((point) => [point.at, point.value]));
  const observeAt = (at: number): Observation => {
    const value = values.get(at) ?? null;
    if (value === null) return { kind: 'missing' };
    return { kind: 'value', value, holds: thresholdHolds(threshold, value) };
  };
  return trackSeries({
    rule: replayRule(threshold.for, every),
    direction: threshold.op,
    times: points.map((point) => point.at),
    observeAt,
    end,
  });
}

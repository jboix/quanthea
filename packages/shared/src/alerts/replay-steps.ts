/**
 * The core of a replay, shared by the server and the browser: feed the state machine one
 * observation per evaluation, in time order, and collect when a series fired and when the
 * condition held too briefly to fire. The server reads each evaluation's window from the query's
 * points; the browser judges the readings the server returned again under a condition a person
 * changed, such as a threshold being dragged, with the same rules. Pure.
 */
import { durationMs } from '../spec/alert.ts';
import type { AlertCondition } from '../spec/alert-condition.ts';
import { conditionDirection, conditionHolds, type Reading } from './conditions.ts';
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
  /**
   * What each test of the condition read, when that is more than the value: the earlier point of
   * a change, the values of the parts of a joined condition.
   */
  readonly readings?: readonly Reading[] | undefined;
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
    tracker.points.push(pointOf(at, observation));
    const step = stepSeries(state, observation, run.rule, at);
    if (step.transition) record(tracker, step.transition);
    else if (tracker.pending)
      tracker.pending.peak = extreme(run.direction, tracker.pending.peak, value);
    state = step.next ?? undefined;
  }
  return summarize(tracker, run.end);
}

/**
 * The point an evaluation leaves on a replay: its value, and the readings beside it.
 *
 * @param at - The evaluation.
 * @param observation - What it observed.
 * @returns The point.
 */
function pointOf(at: number, observation: Observation): ReplayPoint {
  if (observation.kind !== 'value') return { at, value: null };
  const { value, readings } = observation;
  return readings ? { at, value, readings } : { at, value };
}

/**
 * Judges the points of one replayed series again under another condition, as the server would
 * have: each point is an evaluation, and a point without a value or a reading is a series the
 * result left out. The condition must read what the replayed one read: the same tests on the same
 * fields, reducers and spans. Its numbers, operators, directions, joiner and `for` may differ.
 *
 * @param points - The readings at each evaluation, from a replay.
 * @param condition - The condition to judge them under.
 * @param every - How often the alert is evaluated, for the grace of a missing series.
 * @param end - The end of the replay's window.
 * @returns How the series would have behaved.
 */
export function replayUnder(
  points: readonly ReplayPoint[],
  condition: AlertCondition,
  every: string,
  end: number,
): ReplayTrack {
  const byTime = new Map(points.map((point) => [point.at, point]));
  const observeAt = (at: number): Observation => {
    const point = byTime.get(at);
    const readings = point?.readings ?? [{ value: point?.value ?? null }];
    if (readings.every((reading) => reading.value === null)) return { kind: 'missing' };
    const holds = conditionHolds(condition, readings);
    return { kind: 'value', value: point?.value ?? null, holds, readings: point?.readings };
  };
  return trackSeries({
    rule: replayRule(condition.for, every),
    direction: conditionDirection(condition),
    times: points.map((point) => point.at),
    observeAt,
    end,
  });
}

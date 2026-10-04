/**
 * What changes made by hand on a live alert's page would do, before they are saved: the values
 * changed, how often the alert would have fired over the chart's window, replayed again in the
 * browser with the shared rules, and which series would change state now, from their current
 * values.
 */
import {
  type AlertDetail,
  type AlertSpec,
  alertValueText,
  durationMs,
  thresholdHolds,
} from '@quanthea/shared';
import { durationWords, everyWords, type Replayed, seriesUnder } from '../alert-draft/index.ts';
import { seriesName } from './words.ts';

/** A series as it is now. */
type SeriesNow = AlertDetail['series'][number];

/** What would happen to a series now. */
type Outcome = 'would stop firing' | 'would stop pending' | 'would start pending' | 'would fire';

/** The most series named in one outcome; past it they are counted. */
const maxNamed = 3;

/**
 * The threshold's value in the alert's format, with the operator when it changed.
 *
 * @param spec - The spec.
 * @param withOp - Whether to name the operator.
 * @returns Such as `2%` or `above 2%`.
 */
function thresholdText(spec: AlertSpec, withOp: boolean): string {
  const { condition } = spec;
  if (condition.kind !== 'threshold') return 'no data';
  const value = alertValueText(spec, condition.value) || String(condition.value);
  return withOp ? `${condition.op} ${value}` : value;
}

/**
 * The values changed, in words.
 *
 * @param saved - The active version's spec.
 * @param tuned - The spec with the changes.
 * @returns Such as `threshold 2% → 2.5%, wait 5 minutes → 10 minutes`.
 */
export function changeWords(saved: AlertSpec, tuned: AlertSpec): string {
  const withOp = operatorOf(saved) !== operatorOf(tuned);
  const words = [
    change('threshold', thresholdText(saved, withOp), thresholdText(tuned, withOp)),
    change('wait', durationWords(saved.condition.for), durationWords(tuned.condition.for)),
    change('checked', everyWords(saved.every), everyWords(tuned.every)),
  ];
  return words.filter((each) => each !== undefined).join(', ') || 'no value';
}

/**
 * The operator of a threshold condition.
 *
 * @param spec - The spec.
 * @returns `above`, `below`, or nothing for another condition.
 */
function operatorOf(spec: AlertSpec): string | undefined {
  return spec.condition.kind === 'threshold' ? spec.condition.op : undefined;
}

/**
 * One value changed, in words.
 *
 * @param name - The value's name.
 * @param before - How it read.
 * @param after - How it reads now.
 * @returns Such as `wait 5 minutes → 10 minutes`, or nothing when it reads the same.
 */
function change(name: string, before: string, after: string): string | undefined {
  return before === after ? undefined : `${name} ${before} → ${after}`;
}

/**
 * A number of firings in words.
 *
 * @param count - How many.
 * @returns Such as `1 time` or `2 times`.
 */
function timesWords(count: number): string {
  return `${count} ${count === 1 ? 'time' : 'times'}`;
}

/**
 * How often the alert would have fired over the window with the changes, against as saved.
 *
 * @param replay - The replay of the active version over the window.
 * @param tuned - The spec with the changes.
 * @param window - The window, such as `Last 7 days`.
 * @returns Such as `Last 7 days: would have fired 1 time instead of 2.`; nothing without a
 *   threshold.
 */
export function pastComparison(replay: Replayed, tuned: AlertSpec, window: string) {
  const { condition } = tuned;
  if (condition.kind !== 'threshold') return undefined;
  const before = replay.series.reduce((sum, each) => sum + each.firings, 0);
  const after = seriesUnder(replay, condition, tuned.every).reduce(
    (sum, each) => sum + each.track.firings,
    0,
  );
  if (before === after)
    return after === 0
      ? `${window}: would still not have fired.`
      : `${window}: would still have fired ${timesWords(after)}.`;
  return `${window}: would have fired ${timesWords(after)} instead of ${before}.`;
}

/**
 * What would happen to one series now under the changed condition.
 *
 * @param series - The series as it is now.
 * @param tuned - The spec with the changes.
 * @param now - The current time.
 * @returns The outcome, or nothing when its state would stay.
 */
function outcomeOf(series: SeriesNow, tuned: AlertSpec, now: number): Outcome | undefined {
  const { condition } = tuned;
  if (condition.kind !== 'threshold' || series.value === null) return undefined;
  const wait = durationMs(condition.for);
  const step = {
    holds: thresholdHolds(condition, series.value),
    waited: now - series.since >= wait,
    atOnce: wait === 0,
  };
  return outcomes[series.state]?.(step);
}

/** What a series' value says under the changed condition. */
interface Step {
  /** Whether the condition holds for its current value. */
  readonly holds: boolean;
  /** Whether it has been in its state for the condition's wait. */
  readonly waited: boolean;
  /** Whether the condition fires at once. */
  readonly atOnce: boolean;
}

/** What would happen to a series in each state that can change. */
const outcomes: Partial<Record<SeriesNow['state'], (step: Step) => Outcome | undefined>> = {
  firing: ({ holds }) => (holds ? undefined : 'would stop firing'),
  pending: ({ holds, waited }) => {
    if (!holds) return 'would stop pending';
    return waited ? 'would fire' : undefined;
  },
  ok: ({ holds, atOnce }) => {
    if (!holds) return undefined;
    return atOnce ? 'would fire' : 'would start pending';
  },
};

/**
 * Names series: a few by name, more by count.
 *
 * @param names - The names.
 * @returns Such as `checkout-svc`, `cart and checkout`, or `4 series`.
 */
function namesWords(names: readonly string[]): string {
  if (names.length > maxNamed) return `${names.length} series`;
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Which series would change state now with the changes, from their current values.
 *
 * @param series - The series as they are now.
 * @param tuned - The spec with the changes.
 * @param now - The current time.
 * @returns Such as `Right now: checkout-svc would stop firing.`
 */
export function nowComparison(series: readonly SeriesNow[], tuned: AlertSpec, now: number) {
  const outcomes = new Map<Outcome, string[]>();
  for (const each of series) {
    const outcome = outcomeOf(each, tuned, now);
    if (outcome) outcomes.set(outcome, [...(outcomes.get(outcome) ?? []), seriesName(each.labels)]);
  }
  if (outcomes.size === 0) return 'Right now: no series would change state.';
  const parts = [...outcomes].map(([outcome, names]) => `${namesWords(names)} ${outcome}`);
  return `Right now: ${parts.join('; ')}.`;
}

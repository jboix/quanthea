/**
 * Judges a condition from what one evaluation read of a series. Reading the points is the
 * server's: it gives one reading per test of the condition, in order. Judging is pure and shared,
 * so the evaluator, the replay and the browser, which judges a replay again under values a person
 * changed, agree.
 */
import type { AlertCondition, ConditionTest } from '../spec/alert-condition.ts';
import { conditionTests } from '../spec/alert-condition.ts';

/** What one evaluation read of a series for one test. */
export interface Reading {
  /** The value: the points of the window reduced, or the latest point for a change. */
  readonly value: number | null;
  /** The earlier point a change compares with; `null` when the window holds none. */
  readonly reference?: number | null | undefined;
}

/** A threshold: an operator and a number. */
type Threshold = Pick<Extract<ConditionTest, { kind: 'threshold' }>, 'op' | 'value'>;

/** A change: a direction, an amount and its unit. */
type Change = Pick<Extract<ConditionTest, { kind: 'change' }>, 'direction' | 'amount' | 'unit'>;

/** How far a comparison may be off through rounding, as a share of the amount. */
const tolerance = 1e-9;

/**
 * Whether a threshold holds for a value.
 *
 * @param threshold - The operator and the threshold.
 * @param value - The value, if any.
 * @returns `true` when the value is strictly past the threshold.
 */
export function thresholdHolds(threshold: Threshold, value: number | null): boolean {
  if (value === null) return false;
  return threshold.op === 'above' ? value > threshold.value : value < threshold.value;
}

/**
 * How much a value changed from the earlier point, signed: positive for a rise.
 *
 * @param unit - A share of the earlier value in percent, or the difference.
 * @param reading - The value and the earlier point.
 * @returns The change, or `null` without a value or an earlier point, and for a share of zero.
 */
export function changeBetween(unit: Change['unit'], reading: Reading): number | null {
  const { value, reference } = reading;
  if (value === null || reference === null || reference === undefined) return null;
  if (unit === 'absolute') return value - reference;
  if (reference === 0) return null;
  return ((value - reference) / Math.abs(reference)) * 100;
}

/**
 * Whether a change holds for a reading.
 *
 * @param change - The direction, the amount and its unit.
 * @param reading - The value and the earlier point.
 * @returns `true` when the value moved that way by the amount or more; never without a change.
 */
export function changeHolds(change: Change, reading: Reading): boolean {
  const moved = changeBetween(change.unit, reading);
  if (moved === null) return false;
  const towards = change.direction === 'up' ? moved : -moved;
  return towards >= change.amount * (1 - tolerance);
}

/**
 * The value a series must reach for a change to hold, given its earlier point.
 *
 * @param change - The direction, the amount and its unit.
 * @param reference - The earlier point, if any.
 * @returns The limit, or `null` without an earlier point, and for a share of zero.
 */
export function changeLimit(change: Change, reference: number | null | undefined): number | null {
  if (reference === null || reference === undefined) return null;
  if (change.unit === 'percent' && reference === 0) return null;
  const step =
    change.unit === 'absolute' ? change.amount : (Math.abs(reference) * change.amount) / 100;
  return change.direction === 'up' ? reference + step : reference - step;
}

/**
 * Whether one test holds for its reading.
 *
 * @param test - The test.
 * @param reading - What the evaluation read for it.
 * @returns Whether it holds; a test without a value never does.
 */
export function testHolds(test: ConditionTest, reading: Reading): boolean {
  return test.kind === 'change' ? changeHolds(test, reading) : thresholdHolds(test, reading.value);
}

/**
 * Whether a condition holds for the readings of a series.
 *
 * @param condition - The condition.
 * @param readings - One reading per test, in the order of {@link conditionTests}.
 * @returns Whether it holds: every test for `all`, at least one for `any`. `no_data` never holds
 *   for a series: it is about the query as a whole.
 */
export function conditionHolds(condition: AlertCondition, readings: readonly Reading[]): boolean {
  const tests = conditionTests(condition);
  if (tests.length === 0) return false;
  const held = tests.map((test, index) => testHolds(test, readings[index] ?? { value: null }));
  return condition.kind === 'any' ? held.some(Boolean) : held.every(Boolean);
}

/**
 * Which way a condition points, for the extreme value of a short spike.
 *
 * @param condition - The condition.
 * @returns The way of its first test: `above` for a rise too, `below` for a drop; `undefined`
 *   without a test.
 */
export function conditionDirection(condition: AlertCondition): 'above' | 'below' | undefined {
  const [first] = conditionTests(condition);
  if (!first) return undefined;
  if (first.kind === 'threshold') return first.op;
  return first.direction === 'up' ? 'above' : 'below';
}

/**
 * The readings worth keeping beside a series' value: none when the value alone says it all.
 *
 * @param readings - The readings of a series.
 * @returns The readings, or `undefined` for one reading without an earlier point.
 */
export function readingsBeside(readings: readonly Reading[]): readonly Reading[] | undefined {
  const [first] = readings;
  return readings.length === 1 && first?.reference === undefined ? undefined : readings;
}

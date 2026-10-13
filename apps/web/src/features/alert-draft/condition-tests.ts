/**
 * The tests of a draft's condition as values a person changes by hand: the threshold, the change,
 * the comparison with the past or the band of each test, the field a part of a joined condition
 * reads, and how the parts are joined. Each change returns the whole spec, as the rest of the sentence does.
 */
import {
  type AlertSpec,
  agoText,
  amountText,
  bandSideText,
  type ConditionTest,
  conditionTests,
  durationMs,
  testValueText,
} from '@quanthea/shared';
import { durationWords } from './condition.ts';

/** A change test. */
export type ChangeTest = Extract<ConditionTest, { kind: 'change' }>;

/** A comparison with the past. */
export type PastTest = Extract<ConditionTest, { kind: 'past' }>;

/** A band test. */
export type BandTest = Extract<ConditionTest, { kind: 'band' }>;

/** A threshold test. */
export type ThresholdTest = Extract<ConditionTest, { kind: 'threshold' }>;

/**
 * Whether a condition joins tests.
 *
 * @param spec - The spec.
 * @returns `true` for `all` and `any`.
 */
export function isJoined(spec: AlertSpec): boolean {
  return spec.condition.kind === 'all' || spec.condition.kind === 'any';
}

/**
 * The spec with fields of one test replaced; a field set to `undefined` is taken away.
 *
 * @param spec - The spec.
 * @param index - The test, in the order of the condition's tests.
 * @param patch - The fields to set.
 * @returns The new spec; the same spec when the condition has no such test.
 */
export function withTest(
  spec: AlertSpec,
  index: number,
  patch: Readonly<Record<string, unknown>>,
): AlertSpec {
  const { condition } = spec;
  const test = conditionTests(condition)[index];
  if (!test) return spec;
  const merged = Object.fromEntries(
    Object.entries({ ...test, ...patch }).filter(([, value]) => value !== undefined),
  );
  if (condition.kind !== 'all' && condition.kind !== 'any')
    return { ...spec, condition: merged } as AlertSpec;
  const of = condition.of.map((each, position) => (position === index ? merged : each));
  return { ...spec, condition: { ...condition, of } } as AlertSpec;
}

/**
 * The spec with another span for a change, keeping the window longer than it.
 *
 * @param spec - The spec.
 * @param index - The change test.
 * @param within - The span, such as `10m`.
 * @returns The new spec; a window that was too short becomes twice the span.
 */
export function withWithin(spec: AlertSpec, index: number, within: string): AlertSpec {
  const match = /^(\d+)([smhd])$/.exec(within);
  const fits = durationMs(spec.lookback) > durationMs(within);
  const lookback = fits || !match ? spec.lookback : `${Number(match[1]) * 2}${match[2]}`;
  return withTest({ ...spec, lookback }, index, { within });
}

/**
 * The spec with its tests joined another way.
 *
 * @param spec - The spec, with a joined condition.
 * @param kind - `all` when every test must hold, `any` when one is enough.
 * @returns The new spec.
 */
export function withJoiner(spec: AlertSpec, kind: 'all' | 'any'): AlertSpec {
  const { condition } = spec;
  if (condition.kind !== 'all' && condition.kind !== 'any') return spec;
  return { ...spec, condition: { ...condition, kind } };
}

/**
 * A threshold test in words.
 *
 * @param spec - The spec.
 * @param test - The test.
 * @param value - The threshold, if it moved from the test's.
 * @returns Such as `above 2%`.
 */
export function thresholdTestWords(spec: AlertSpec, test: ThresholdTest, value?: number): string {
  const shown = value ?? test.value;
  return `${test.op} ${testValueText(spec, test, shown) || String(shown)}`;
}

/**
 * A change test in words, without its span.
 *
 * @param spec - The spec.
 * @param test - The test.
 * @returns Such as `drops by at least 50%` or `rises by at least 200`.
 */
export function changeTestWords(spec: AlertSpec, test: ChangeTest): string {
  const verb = test.direction === 'up' ? 'rises' : 'drops';
  return `${verb} by at least ${amountText(spec, test, test.amount) || String(test.amount)}`;
}

/**
 * The span of a change in words.
 *
 * @param test - The test.
 * @returns Such as `10 minutes`.
 */
export function withinWords(test: ChangeTest): string {
  return durationWords(test.within);
}

/**
 * A comparison with the past in words, without how far back it looks.
 *
 * @param spec - The spec.
 * @param test - The test.
 * @returns Such as `at least 30% above` or `at least 200 below`.
 */
export function pastTestWords(spec: AlertSpec, test: PastTest): string {
  const amount = amountText(spec, test, test.amount) || String(test.amount);
  return `at least ${amount} ${test.direction === 'up' ? 'above' : 'below'}`;
}

/**
 * How far back a comparison with the past looks, in words.
 *
 * @param test - The test.
 * @returns Such as `a week earlier`.
 */
export function agoWords(test: PastTest): string {
  return agoText(test.ago);
}

/**
 * A band test in words, without its baseline.
 *
 * @param test - The test.
 * @returns Such as `more than 3 deviations above` or `more than 2 deviations from`.
 */
export function bandTestWords(test: BandTest): string {
  return bandSideText(test);
}

/**
 * How long the condition holds before it fires, with the word that leads to it.
 *
 * @param spec - The spec.
 * @returns `for ` before a duration, nothing before `at once`.
 */
export function holdLead(spec: AlertSpec): string {
  return durationMs(spec.condition.for) > 0 ? 'for ' : '';
}

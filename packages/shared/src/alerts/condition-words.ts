/**
 * A condition and its readings as short text, for notifications, lists and the agent: `above 2%`,
 * `down 50% or more within 10m`, `above 2% and requests above 100`. The words follow a subject,
 * as in "checkout is above 2%".
 */
import { createFormatter } from '../formatters/format.ts';
import type { NamedFormatter } from '../formatters/schema.ts';
import {
  type AlertCondition,
  type ConditionTest,
  conditionTests,
} from '../spec/alert-condition.ts';
import { changeBetween, type Reading } from './conditions.ts';

/** What says how an alert's value reads: its `value.format`. */
export interface ValueFormatted {
  /** The alert's value. */
  readonly value: { readonly format?: NamedFormatter | undefined };
}

/** An alert's value format and its condition. */
type Conditioned = ValueFormatted & { readonly condition: AlertCondition };

/**
 * Writes a number in a format, or with four significant digits.
 *
 * @param format - The format, if any.
 * @param value - The number.
 * @returns The text.
 */
function numberText(format: NamedFormatter | undefined, value: number): string {
  if (format) return createFormatter(format)(value);
  return new Intl.NumberFormat('en', { maximumSignificantDigits: 4 }).format(value);
}

/**
 * Writes a value as the spec's format asks, or with four significant digits.
 *
 * @param spec - The spec.
 * @param value - The value.
 * @returns The text; empty without a value.
 */
export function alertValueText(spec: ValueFormatted, value: number | null): string {
  return value === null ? '' : numberText(spec.value.format, value);
}

/**
 * Writes a value a test read: in the test's own format, else in the alert's.
 *
 * @param spec - The spec.
 * @param test - The test.
 * @param value - The value.
 * @returns The text; empty without a value.
 */
export function testValueText(
  spec: ValueFormatted,
  test: ConditionTest,
  value: number | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  const own = 'format' in test ? test.format : undefined;
  return numberText(own ?? spec.value.format, value);
}

/**
 * Writes the amount of a change.
 *
 * @param spec - The spec.
 * @param test - The change.
 * @param amount - The amount, in the change's unit.
 * @returns Such as `50%`, or the difference in the value's format.
 */
export function amountText(
  spec: ValueFormatted,
  test: Extract<ConditionTest, { kind: 'change' }>,
  amount: number,
): string {
  if (test.unit === 'absolute') return testValueText(spec, test, amount);
  return `${new Intl.NumberFormat('en', { maximumSignificantDigits: 3 }).format(amount)}%`;
}

/**
 * Writes one test, after its subject.
 *
 * @param spec - The spec.
 * @param test - The test.
 * @returns Such as `above 2%` or `down 50% or more within 10m`.
 */
export function testText(spec: ValueFormatted, test: ConditionTest): string {
  if (test.kind === 'threshold') return `${test.op} ${testValueText(spec, test, test.value)}`;
  const amount = amountText(spec, test, test.amount);
  return `${test.direction} ${amount} or more within ${test.within}`;
}

/**
 * The name a test goes by beside the others: the field it reads, when it names one.
 *
 * @param test - The test.
 * @returns The field and a space, or nothing for a test on the alert's value.
 */
function namePrefix(test: ConditionTest): string {
  return 'field' in test && test.field !== undefined ? `${test.field} ` : '';
}

/**
 * Writes a condition, after its subject, without its `for`.
 *
 * @param spec - The value format and the condition.
 * @returns Such as `above 2%`, `no data`, or `above 2% and requests above 100`.
 */
export function conditionText(spec: Conditioned): string {
  const { condition } = spec;
  if (condition.kind === 'no_data') return 'no data';
  const joiner = condition.kind === 'any' ? ' or ' : ' and ';
  return conditionTests(condition)
    .map((test) => `${namePrefix(test)}${testText(spec, test)}`)
    .join(joiner);
}

/**
 * Writes what every test of a condition read of a series.
 *
 * @param spec - The value format and the condition.
 * @param readings - One reading per test, in order.
 * @returns Such as `2.4%, requests 312`; a test without a value is left out.
 */
export function readingsText(spec: Conditioned, readings: readonly Reading[]): string {
  return conditionTests(spec.condition)
    .flatMap((test, index) => {
      const text = testValueText(spec, test, readings[index]?.value);
      return text === '' ? [] : [`${namePrefix(test)}${text}`];
    })
    .join(', ');
}

/** What the first change of a condition read: how far the value moved, and from where. */
export interface ChangeWords {
  /** The change, signed, such as `-52%` or `+230`; empty when it cannot be worked out. */
  readonly change: string;
  /** The earlier point; empty when the window held none. */
  readonly previous: string;
}

/**
 * Writes the change the first change test of a condition read.
 *
 * @param spec - The value format and the condition.
 * @param readings - One reading per test, in order.
 * @returns The change and the earlier point; both empty for a condition without a change.
 */
export function changeWords(spec: Conditioned, readings: readonly Reading[]): ChangeWords {
  const tests = conditionTests(spec.condition);
  const index = tests.findIndex((test) => test.kind === 'change');
  const test = tests[index];
  const reading = readings[index];
  if (test?.kind !== 'change' || !reading) return { change: '', previous: '' };
  const moved = changeBetween(test.unit, reading);
  const sign = moved !== null && moved < 0 ? '-' : '+';
  return {
    change: moved === null ? '' : `${sign}${amountText(spec, test, Math.abs(moved))}`,
    previous: testValueText(spec, test, reading.reference),
  };
}

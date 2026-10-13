/**
 * Scores the condition an alert conversation saved against the kind and the values a case asks
 * for: a number within 1%, a duration by its length, a word as written. Pure, like the rest of the
 * alert scoring.
 */
import { type AlertCondition, conditionTests, durationMs } from '@quanthea/shared';

/**
 * What a field of a test must be: a number, within 1%, a duration, by its length, or a word. A
 * list holds every value that is right, such as `[0.2, 20]` for 20% as a ratio or in percent.
 */
export type FieldExpectation = string | number | readonly (string | number)[];

/** The fields a test of a condition must have, such as `{ kind: 'change', within: '10m' }`. */
export type TestExpectation = Readonly<Record<string, FieldExpectation>>;

/** The condition a good alert holds, for a case that asks for a kind other than a threshold. */
export interface ConditionExpectation {
  /** Its kind. */
  readonly kind: 'threshold' | 'change' | 'past' | 'band' | 'all' | 'any';
  /** The fields of a single test. */
  readonly fields?: TestExpectation;
  /** The tests of a joined condition, in any order: each must match a test of its own. */
  readonly of?: readonly TestExpectation[];
}

/** How far a number may be from the one asked, relative to it. */
const tolerance = 0.01;

/**
 * Whether a value of a saved test is the one value wanted.
 *
 * @param saved - The saved value.
 * @param wanted - The value wanted.
 * @returns Whether a number is within the tolerance, a duration as long, a word the same.
 */
function matchesOne(saved: unknown, wanted: string | number): boolean {
  if (typeof wanted === 'number')
    return typeof saved === 'number' && Math.abs(saved - wanted) <= Math.abs(wanted) * tolerance;
  if (typeof saved !== 'string') return false;
  const length = durationMs(wanted);
  return Number.isNaN(length) ? saved === wanted : durationMs(saved) === length;
}

/**
 * Whether a value of a saved test is one of the values wanted.
 *
 * @param saved - The saved value.
 * @param wanted - The value wanted, or every value that is right.
 * @returns Whether it matches one.
 */
function matches(saved: unknown, wanted: FieldExpectation): boolean {
  const options = typeof wanted === 'object' ? wanted : [wanted];
  return options.some((option) => matchesOne(saved, option));
}

/**
 * A value wanted, in words.
 *
 * @param wanted - The value wanted, or every value that is right.
 * @returns Such as `50` or `0.2 or 20`.
 */
function wantedWords(wanted: FieldExpectation): string {
  return typeof wanted === 'object' ? wanted.join(' or ') : String(wanted);
}

/**
 * What a saved test has otherwise than wanted.
 *
 * @param test - The saved test.
 * @param wanted - The fields wanted.
 * @returns A reason per field, such as `within is 5m, expected 10m`.
 */
function fieldFaults(test: Readonly<Record<string, unknown>>, wanted: TestExpectation): string[] {
  return Object.entries(wanted).flatMap(([name, value]) =>
    matches(test[name], value)
      ? []
      : [`${name} is ${String(test[name])}, expected ${wantedWords(value)}`],
  );
}

/**
 * What is wrong with the tests of a joined condition: each test wanted must match a saved test of
 * its own, in any order.
 *
 * @param tests - The saved tests.
 * @param wanted - The tests wanted.
 * @returns A reason per test wanted that no saved test matches.
 */
function partFaults(
  tests: readonly Readonly<Record<string, unknown>>[],
  wanted: readonly TestExpectation[],
): string[] {
  const free = [...tests];
  return wanted.flatMap((each) => {
    const found = free.findIndex((test) => fieldFaults(test, each).length === 0);
    if (found < 0) return [`no test of the condition is ${JSON.stringify(each)}`];
    free.splice(found, 1);
    return [];
  });
}

/**
 * What is wrong with the kind and the values of a saved condition.
 *
 * @param condition - The saved condition.
 * @param expect - The kind and the values a good alert holds.
 * @returns The reasons.
 */
export function kindFaults(condition: AlertCondition, expect: ConditionExpectation): string[] {
  if (condition.kind !== expect.kind)
    return [`the condition is ${condition.kind}, expected ${expect.kind}`];
  const tests: readonly Readonly<Record<string, unknown>>[] = conditionTests(condition);
  const [first = {}] = tests;
  return [...fieldFaults(first, expect.fields ?? {}), ...partFaults(tests, expect.of ?? [])];
}

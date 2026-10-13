/**
 * The ratio of two queries: the first query's value divided by the second's. A series of the
 * first query is divided by the one series of the second whose labels agree with its own. The
 * evaluator, the check and the replay all divide through here, so they agree.
 */
import type { AlertSpec, Frame, RatioZeroRule, Reading } from '@quanthea/shared';
import { type ObservedSeries, type SeriesExtraction, seriesOf } from './series.ts';

/** The labels of a series. */
type Labels = Readonly<Record<string, string>>;

/** The most series of the second query a ratio reads. */
const maxDivisorSeries = 1000;

/**
 * Divides one value by another.
 *
 * @param numerator - The first query's value, if any.
 * @param denominator - The second query's value, if any.
 * @param whenZero - What a division by 0 reads: the number 0, or no value.
 * @returns The ratio; `null` without either value, and for a division by 0 under `no_value`.
 */
export function divide(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  whenZero: RatioZeroRule,
): number | null {
  if (typeof numerator !== 'number' || typeof denominator !== 'number') return null;
  if (denominator === 0) return whenZero === 'zero' ? 0 : null;
  return numerator / denominator;
}

/**
 * The reading of a ratio, from what each side read: the value and, for a change, the earlier
 * point are each divided, and the two sides of the value are kept beside it.
 *
 * @param numerator - What the first query's series read.
 * @param denominator - What the matching series of the second query read.
 * @param whenZero - What a division by 0 reads.
 * @returns The reading.
 */
export function ratioReading(
  numerator: Reading,
  denominator: Reading,
  whenZero: RatioZeroRule,
): Reading {
  const sides = { numerator: numerator.value, denominator: denominator.value };
  const value = divide(numerator.value, denominator.value, whenZero);
  if (numerator.reference === undefined) return { value, ...sides };
  const reference = divide(numerator.reference, denominator.reference, whenZero);
  return { value, reference, ...sides };
}

/**
 * Whether two sets of labels agree: every label both carry has the same value. A label only one
 * of them carries is not compared.
 *
 * @param first - One set.
 * @param second - The other.
 * @returns `true` when no shared label differs; sets that share no label agree.
 */
export function labelsAgree(first: Labels, second: Labels): boolean {
  return Object.entries(first).every(
    ([name, value]) => second[name] === undefined || second[name] === value,
  );
}

/**
 * The series of the second query a series of the first is divided by: the one whose labels agree
 * with its own.
 *
 * @param labels - The labels of the first query's series.
 * @param divisors - The series of the second query.
 * @returns The series, or `undefined` when none agrees, and when more than one does: the second
 *   query then tells apart what the first does not, and no one series is its total.
 */
export function divisorFor(
  labels: Labels,
  divisors: readonly ObservedSeries[],
): ObservedSeries | undefined {
  const agreeing = divisors.filter((each) => labelsAgree(labels, each.labels));
  return agreeing.length === 1 ? agreeing[0] : undefined;
}

/**
 * Reads the result of a ratio's second query as series.
 *
 * @param frames - The frames of the second query.
 * @param spec - The spec, with a second query.
 * @returns Its series, at most 1000, and what does not fit, such as a missing column.
 */
export function divisorSeries(frames: readonly Frame[], spec: AlertSpec): SeriesExtraction {
  const { field, by } = spec.dividedBy ?? {};
  return seriesOf(frames, {
    reduce: spec.value.reduce,
    maxSeries: maxDivisorSeries,
    ...(field === undefined ? {} : { field }),
    ...(by === undefined ? {} : { by }),
  });
}

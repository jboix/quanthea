/** Reduces a result column to one number, for stat panels. */
import type { Frame, QueryOutcome, Reduce } from '@querent/shared';

/** The reductions over a list of finite numbers. */
const reducers: Readonly<Record<Reduce, (numbers: readonly number[]) => number | undefined>> = {
  first: (numbers) => numbers[0],
  last: (numbers) => numbers.at(-1),
  max: (numbers) => (numbers.length > 0 ? Math.max(...numbers) : undefined),
  min: (numbers) => (numbers.length > 0 ? Math.min(...numbers) : undefined),
  sum: (numbers) => numbers.reduce((total, each) => total + each, 0),
  mean: (numbers) =>
    numbers.length > 0
      ? numbers.reduce((total, each) => total + each, 0) / numbers.length
      : undefined,
  count: (numbers) => numbers.length,
};

/**
 * The values of a field across the frames of a result. Without a field name, the first number
 * field of each frame.
 *
 * @param frames - The frames.
 * @param field - The field name, if the view names one.
 * @returns The values, frame after frame.
 */
export function columnValues(frames: readonly Frame[], field?: string): unknown[] {
  return frames.flatMap((frame) => {
    const index = frame.fields.findIndex((each) =>
      field === undefined ? each.type === 'number' : each.name === field,
    );
    return index < 0 ? [] : (frame.values[index] ?? []);
  });
}

/**
 * Reduces values to one number.
 *
 * @param values - The values; anything that is not a finite number is skipped.
 * @param reduce - How to reduce.
 * @returns The number, or `undefined` when there is nothing to reduce.
 */
export function reduceValues(values: readonly unknown[], reduce: Reduce): number | undefined {
  const numbers = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return reducers[reduce](numbers);
}

/**
 * Reduces the named result of a panel.
 *
 * @param queries - The outcomes of the panel's queries.
 * @param ref - The refId.
 * @param reduce - How to reduce.
 * @param field - The field, if the view names one.
 * @returns The number, or `undefined`.
 */
export function reduceResult(
  queries: readonly QueryOutcome[],
  ref: string,
  reduce: Reduce,
  field?: string,
): number | undefined {
  const frames = queries.find((query) => query.refId === ref)?.frames ?? [];
  return reduceValues(columnValues(frames, field), reduce);
}

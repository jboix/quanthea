/**
 * Reduces a result column to one number, for stat panels. Results are read as datasets, the same
 * table the charts read, so a column has the same name whichever view shows it.
 */
import {
  type Dataset,
  datasetOfFrames,
  type Frame,
  type QueryOutcome,
  type Reduce,
} from '@quanthea/shared';

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
 * The index of a column: the one named, matched exactly and then in any case, as views written
 * before datasets name a series' value `Value`; without a name, the first number column.
 *
 * @param dataset - The dataset.
 * @param field - The column's name, if the view names one.
 * @returns The index, or -1.
 */
export function columnIn(dataset: Dataset, field?: string): number {
  const names = dataset.dimensions.map((column) => column.name);
  if (field === undefined)
    return dataset.dimensions.findIndex((column) => column.type === 'number');
  const exact = names.indexOf(field);
  return exact >= 0 ? exact : names.findIndex((name) => name.toLowerCase() === field.toLowerCase());
}

/**
 * The values of a column of a result. Without a column name, the first number column.
 *
 * @param frames - The frames.
 * @param field - The column name, if the view names one.
 * @returns The values, row after row.
 */
export function columnValues(frames: readonly Frame[], field?: string): unknown[] {
  const dataset = datasetOfFrames(frames);
  const index = columnIn(dataset, field);
  return index < 0 ? [] : dataset.source.map((row) => row[index] ?? null);
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

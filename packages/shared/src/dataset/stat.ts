/**
 * Reduces a result column to one number, for stat panels and the headline numbers of reports, and
 * to the one value a stat's mappings read. Results are read as datasets, the same table the charts
 * read, so a column has the same name whichever view shows it.
 */
import type { Frame } from '@quanthea/plugin-kit/contract';
import type { QueryOutcome } from '../api/panels.ts';
import type { Reduce } from '../spec/views.ts';
import type { Dataset } from './contract.ts';
import { datasetOfFrames } from './from-frames.ts';

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
export function statColumnIndex(dataset: Dataset, field?: string): number {
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
export function resultColumn(frames: readonly Frame[], field?: string): unknown[] {
  const dataset = datasetOfFrames(frames);
  const index = statColumnIndex(dataset, field);
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
  return reduceValues(resultColumn(frames, field), reduce);
}

/**
 * The first or the last value a column holds, whatever its type.
 *
 * @param values - The values, row after row.
 * @param reduce - Which end to read.
 * @returns The value, or `undefined` when the column is empty or holds no value at all.
 */
function endValue(values: readonly unknown[], reduce: 'first' | 'last'): unknown {
  const held = values.filter((value) => value !== null && value !== undefined);
  return reduce === 'first' ? held[0] : held.at(-1);
}

/**
 * The value a stat's mappings read. With `first` or `last` it is the column's own value, so a
 * text or a boolean is kept, and a column of numbers gives the number {@link reduceResult} gives.
 * Any other reduction computes a number, so it is that number.
 *
 * @param queries - The outcomes of the panel's queries.
 * @param ref - The refId.
 * @param reduce - How to reduce.
 * @param field - The field, if the view names one.
 * @returns The value, or `undefined` when the result has no row or no value.
 */
export function mappedResult(
  queries: readonly QueryOutcome[],
  ref: string,
  reduce: Reduce,
  field?: string,
): unknown {
  const frames = queries.find((query) => query.refId === ref)?.frames ?? [];
  const values = resultColumn(frames, field);
  if (reduce !== 'first' && reduce !== 'last') return reduceValues(values, reduce);
  return endValue(values, reduce);
}

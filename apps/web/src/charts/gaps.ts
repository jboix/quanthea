/**
 * How a time chart shows a stretch with no data: as nothing. A source that returns only the rows
 * it has leaves a hole in the times, and a line would run straight across it, as if the value had
 * held. A row of missing values in each hole breaks every line there. A point with nothing on
 * either side has no line to show it, so it is drawn as a dot.
 */
import { columnIndex, type Dataset } from '@quanthea/shared';
import { isMissing } from './dense.ts';
import { isObject, type Loose } from './loose.ts';
import { onTimeAxis } from './period-axis.ts';
import type { Prepared } from './prepare/types.ts';
import { allColumns } from './roles.ts';

/** How much wider than the interval a hole is: this leaves room for months and for days of 23 hours. */
const holeFactor = 1.5;

/** The size of the dot of a point with nothing on either side, in pixels. */
const lonePointSize = 5;

/**
 * The interval the rows of a time chart are apart: the smallest step between two times, when at
 * least half the steps are that wide. Buckets of a query are; rows at the times of events are
 * not, and have no interval a hole could be wider than.
 *
 * @param times - The times of the rows, ascending.
 * @returns The interval in milliseconds, or `undefined` when the rows are not on one.
 */
export function intervalOf(times: readonly number[]): number | undefined {
  const steps = times
    .slice(1)
    .map((time, index) => time - (times[index] ?? time))
    .filter((step) => step > 0);
  if (steps.length === 0) return undefined;
  const interval = steps.reduce((least, step) => Math.min(least, step));
  const regular = steps.filter((step) => step <= interval * holeFactor).length;
  return regular * 2 >= steps.length ? interval : undefined;
}

/**
 * The times of a dataset's rows, when every one is a number and they ascend.
 *
 * @param dataset - The dataset.
 * @param at - The index of its time column.
 * @returns The times, or `undefined` when a row has none or they are out of order.
 */
function ascendingTimes(dataset: Dataset, at: number): number[] | undefined {
  const times = dataset.source.map((row) => row[at]);
  const ordered = times.every(
    (time, index) => typeof time === 'number' && (index === 0 || time >= Number(times[index - 1])),
  );
  return ordered ? (times as number[]) : undefined;
}

/**
 * A dataset with a row of missing values in each hole of its times: where two rows are further
 * apart than one interval. The row sits one interval after the last row before the hole.
 *
 * @param dataset - The dataset, sorted by time.
 * @param x - Its time column.
 * @returns The dataset, the same when its rows are on no interval or have no hole.
 */
export function withHoles(dataset: Dataset, x: string): Dataset {
  const at = columnIndex(dataset, x);
  const times = at < 0 ? undefined : ascendingTimes(dataset, at);
  const interval = times && intervalOf(times);
  if (!times || interval === undefined) return dataset;
  const source = dataset.source.flatMap((row, index) => {
    const before = times[index - 1];
    if (before === undefined || (times[index] ?? before) - before <= interval * holeFactor)
      return [row];
    return [row.map((_cell, column) => (column === at ? before + interval : null)), row];
  });
  return source.length === dataset.source.length ? dataset : { ...dataset, source };
}

/** The series types a row of missing values draws as nothing. */
const gapTypes: ReadonlySet<unknown> = new Set(['line', 'bar']);

/**
 * The prepared data of a time chart of lines and bars, with a row of missing values in each hole
 * of its times. Any other chart is left as it is.
 *
 * @param prepared - The prepared data and option.
 * @returns The prepared data.
 */
export function withHolesShown(prepared: Prepared): Prepared {
  const [main, ...rest] = prepared.datasets;
  const [x] = allColumns(prepared.roles, 'x');
  const templates = [prepared.option.series ?? []].flat().filter(isObject);
  const drawsGaps = templates.length > 0 && templates.every((each) => gapTypes.has(each.type));
  if (!main || !x || prepared.expanded || prepared.groups) return prepared;
  if (!drawsGaps || !onTimeAxis(prepared.option)) return prepared;
  return { ...prepared, datasets: [withHoles(main, x), ...rest] };
}

/**
 * The rows where a column has a value and none in the row before or after: points no line
 * reaches.
 *
 * @param rows - The rows.
 * @param column - The index of the value column.
 * @returns The indexes of those rows.
 */
function lonePoints(rows: readonly (readonly unknown[])[], column: number): Set<number> {
  const has = (index: number) => {
    const row = rows[index];
    return row !== undefined && !isMissing(row[column]);
  };
  const alone = rows.flatMap((_row, index) =>
    has(index) && !has(index - 1) && !has(index + 1) ? [index] : [],
  );
  return new Set(alone);
}

/**
 * What a line without symbols takes to draw its lone points as dots, since no line shows them.
 *
 * @param rows - The rows the line draws.
 * @param column - The index of its value column.
 * @returns The settings to spread on the series: none when it has no lone point.
 */
export function lonePointDots(rows: readonly (readonly unknown[])[], column: number): Loose {
  const alone = lonePoints(rows, column);
  if (alone.size === 0) return {};
  const symbolSize = (_value: unknown, point: { dataIndex: number }) =>
    alone.has(point.dataIndex) ? lonePointSize : 0;
  return { showSymbol: true, showAllSymbol: true, symbol: 'circle', symbolSize };
}

/**
 * A line without symbols whose lone points are drawn as dots.
 *
 * @param series - The series, its encode resolved to columns.
 * @param dataset - The dataset it reads.
 * @returns The series, the same when it is no such line or has no lone point.
 */
function withLonePoints(series: Loose, dataset: Dataset): Loose {
  const y = isObject(series.encode) ? series.encode.y : undefined;
  const column = typeof y === 'string' ? columnIndex(dataset, y) : -1;
  if (series.type !== 'line' || series.showSymbol !== false || column < 0) return series;
  return { ...series, ...lonePointDots(dataset.source, column) };
}

/**
 * The series of a time chart, each line showing its lone points.
 *
 * @param series - The series, expanded.
 * @param datasets - The prepared datasets.
 * @returns The series.
 */
export function withLonePointsShown(
  series: readonly Loose[],
  datasets: readonly Dataset[],
): Loose[] {
  return series.map((each) => {
    const dataset = datasets[typeof each.datasetIndex === 'number' ? each.datasetIndex : 0];
    return dataset ? withLonePoints(each, dataset) : each;
  });
}

/**
 * Whether a dataset has no value to draw: no row, or only missing values beside its times.
 *
 * @param dataset - The dataset.
 * @param x - Its time column.
 * @returns `true` when a chart of it has no point at all.
 */
export function hasNoPoint(dataset: Dataset, x: string): boolean {
  const at = columnIndex(dataset, x);
  const values = dataset.dimensions.flatMap((column, index) =>
    column.type === 'number' && index !== at ? [index] : [],
  );
  if (values.length === 0) return dataset.source.length === 0;
  return dataset.source.every((row) => values.every((index) => isMissing(row[index])));
}

/**
 * How a chart with many points is drawn, decided from the number of points of each series, after
 * the option is built. A long line without a missing value is drawn through a sample that fits
 * its pixels, bars and points past a size are drawn in one stroke, and a chart with many points
 * does not animate. No value changes: every point drawn, and so every value a tooltip shows, is a
 * point of the data.
 */
import { isObject, type Loose } from './loose.ts';

/** A line with more points than this is sampled to its pixels and draws no symbols. */
export const denseLinePoints = 500;

/** Bars of a series with more points than this are drawn in one stroke (ECharts' large mode). */
export const largeBarPoints = 1000;

/** Points of a scatter series with more points than this are drawn in one stroke. */
export const largeScatterPoints = 2000;

/** A chart that draws more points than this, over all its series, does not animate. */
export const stillPoints = 2000;

/**
 * The rows a series draws.
 *
 * @param series - The series.
 * @param datasets - The option's datasets.
 * @returns Its own data, or the rows of the dataset it reads, with the names of their columns.
 */
function rowsOf(series: Loose, datasets: readonly unknown[]) {
  if (Array.isArray(series.data)) return { rows: series.data as unknown[], columns: [] };
  const dataset = datasets[typeof series.datasetIndex === 'number' ? series.datasetIndex : 0];
  if (!isObject(dataset) || !Array.isArray(dataset.source)) return { rows: [], columns: [] };
  const columns = Array.isArray(dataset.dimensions) ? (dataset.dimensions as unknown[]) : [];
  return { rows: dataset.source as unknown[], columns };
}

/**
 * Whether a value is missing, as ECharts reads it.
 *
 * @param value - A cell of a row.
 * @returns `true` for `null`, `undefined`, `NaN` and the dash ECharts takes for no value.
 */
export function isMissing(value: unknown): boolean {
  return value === null || value === undefined || value === '-' || Number.isNaN(value);
}

/**
 * Whether a line has a missing value among the rows it draws.
 *
 * @param series - The line series.
 * @param datasets - The option's datasets.
 * @returns `true` when the column its `encode.y` names holds one, or any cell of its rows when
 *   the series names no column of an array of rows.
 */
function hasGap(series: Loose, datasets: readonly unknown[]): boolean {
  const { rows, columns } = rowsOf(series, datasets);
  const named = isObject(series.encode) ? series.encode.y : undefined;
  const column = typeof named === 'number' ? named : columns.indexOf(named);
  return rows.some((row) => {
    if (!Array.isArray(row)) return isMissing(row);
    return column >= 0 ? isMissing(row[column]) : row.some(isMissing);
  });
}

/**
 * A long line: sampled to the pixels it has, without symbols.
 *
 * `minmax` keeps, for each pixel of the plot's width, the lowest and the highest point that fall
 * in it, so every point is one of the data. ECharts samples only when there are more points than
 * pixels, and again at each size. It starts each pixel from its first point: when that one is
 * missing it keeps nothing else of the pixel, so a line with a missing value is not sampled.
 *
 * @param series - The line series.
 * @returns The series.
 */
function denseLine(series: Loose): Loose {
  return { ...series, sampling: 'minmax', showSymbol: false };
}

/** What of an option decides how its series are drawn. */
interface Drawn {
  /** The option's datasets. */
  readonly datasets: readonly unknown[];
  /** Whether the option maps values to colours or sizes. */
  readonly mapped: boolean;
}

/**
 * Whether a series may be drawn in one stroke: large mode gives every item of a series the same
 * look and stacks nothing, so a series coloured or sized by its values, or stacked, keeps the
 * usual drawing.
 *
 * @param series - The series.
 * @param mapped - Whether the option maps values to colours or sizes.
 * @returns Whether large mode would draw it as it is.
 */
function drawsAlike(series: Loose, mapped: boolean): boolean {
  const size = series.symbolSize;
  return !mapped && series.stack === undefined && (size === undefined || typeof size === 'number');
}

/**
 * A series as its number of points asks.
 *
 * @param series - The series.
 * @param points - How many points it draws.
 * @param option - What of the option decides: its datasets, and whether it maps values to
 *   colours or sizes.
 * @returns The series, changed when it is long.
 */
function forPoints(series: Loose, points: number, option: Drawn): Loose {
  if (series.type === 'line') {
    const sampled = points > denseLinePoints && !hasGap(series, option.datasets);
    return sampled ? denseLine(series) : series;
  }
  const above = { bar: largeBarPoints, scatter: largeScatterPoints }[String(series.type)];
  if (above === undefined || points <= above || !drawsAlike(series, option.mapped)) return series;
  return { ...series, large: true, largeThreshold: above };
}

/**
 * The option as its number of points asks.
 *
 * @param option - The built option, its series final and its data in place.
 * @returns The option: long lines without a missing value sampled and without symbols, long bar and scatter series in
 *   large mode, and no animation past {@link stillPoints} points.
 */
export function withDensity(option: Loose): Loose {
  if (!('series' in option)) return option;
  const datasets = [option.dataset ?? []].flat();
  const series = [option.series ?? []].flat().filter(isObject);
  const counts = series.map((each) => rowsOf(each, datasets).rows.length);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const drawn = { datasets, mapped: option.visualMap !== undefined };
  return {
    ...option,
    ...(total > stillPoints ? { animation: false } : {}),
    series: series.map((each, index) => forPoints(each, counts[index] ?? 0, drawn)),
  };
}

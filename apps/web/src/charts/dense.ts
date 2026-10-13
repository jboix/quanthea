/**
 * How a chart with many points is drawn, decided from the number of points of each series, after
 * the option is built. A long line is drawn through a sample that fits its pixels, bars and points
 * past a size are drawn in one stroke, and a chart with many points does not animate. No value
 * changes: every point drawn, and so every value a tooltip shows, is a point of the data.
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
 * How many points a series draws.
 *
 * @param series - The series.
 * @param datasets - The option's datasets.
 * @returns The rows of its own data or of the dataset it reads.
 */
function pointsOf(series: Loose, datasets: readonly unknown[]): number {
  if (Array.isArray(series.data)) return series.data.length;
  const dataset = datasets[typeof series.datasetIndex === 'number' ? series.datasetIndex : 0];
  return isObject(dataset) && Array.isArray(dataset.source) ? dataset.source.length : 0;
}

/**
 * A long line: sampled to the pixels it has, without symbols.
 *
 * `minmax` keeps, for each pixel of the plot's width, the lowest and the highest point that fall
 * in it, so no spike and no dip is lost and every point is one of the data. ECharts samples only
 * when there are more points than pixels, and again at each size.
 *
 * @param series - The line series.
 * @returns The series.
 */
function denseLine(series: Loose): Loose {
  return { ...series, sampling: 'minmax', showSymbol: false };
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
 * @param mapped - Whether the option maps values to colours or sizes.
 * @returns The series, changed when it is long.
 */
function forPoints(series: Loose, points: number, mapped: boolean): Loose {
  if (series.type === 'line') return points > denseLinePoints ? denseLine(series) : series;
  const above = { bar: largeBarPoints, scatter: largeScatterPoints }[String(series.type)];
  if (above === undefined || points <= above || !drawsAlike(series, mapped)) return series;
  return { ...series, large: true, largeThreshold: above };
}

/**
 * The option as its number of points asks.
 *
 * @param option - The built option, its series final and its data in place.
 * @returns The option: long lines sampled and without symbols, long bar and scatter series in
 *   large mode, and no animation past {@link stillPoints} points.
 */
export function withDensity(option: Loose): Loose {
  if (!('series' in option)) return option;
  const datasets = [option.dataset ?? []].flat();
  const series = [option.series ?? []].flat().filter(isObject);
  const counts = series.map((each) => pointsOf(each, datasets));
  const total = counts.reduce((sum, count) => sum + count, 0);
  const mapped = option.visualMap !== undefined;
  return {
    ...option,
    ...(total > stillPoints ? { animation: false } : {}),
    series: series.map((each, index) => forPoints(each, counts[index] ?? 0, mapped)),
  };
}

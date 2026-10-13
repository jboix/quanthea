/**
 * The time axis of a chart over the period its panel ran over. A source returns rows only where
 * it has data, so an axis left to its data shows the stretch that has some: a week with a day of
 * data reads like a day. The axis runs from the start to the end of the period instead, and
 * further where the data goes further, so no point is ever cut off.
 */
import { type Dataset, followsTimeRange, type Panel } from '@quanthea/shared';
import { isObject, type Loose } from './loose.ts';

/** The period a panel ran over, as the server resolved it and bound it into the queries. */
export interface ChartPeriod {
  /** The start, in epoch milliseconds. */
  readonly from: number;
  /** The end, in epoch milliseconds. */
  readonly to: number;
}

/**
 * The times of a dataset: the cells of its x column when it is a time, else of its first time
 * column.
 *
 * @param dataset - The dataset.
 * @param x - The x column, if the chart names one.
 * @returns The times, in epoch milliseconds.
 */
function timesOf(dataset: Dataset, x: string | undefined): number[] {
  const named = dataset.dimensions.findIndex((column) => column.name === x);
  const first = dataset.dimensions.findIndex((column) => column.type === 'time');
  const at = dataset.dimensions[named]?.type === 'time' ? named : first;
  return dataset.source
    .map((row) => row[at])
    .filter((cell): cell is number => typeof cell === 'number');
}

/**
 * What a time axis covers: the period, widened to the data where a point lies outside it, as the
 * first bucket of a period does when it starts before the period.
 *
 * @param period - The period.
 * @param datasets - The datasets the chart draws.
 * @param x - The x column, if the chart names one.
 * @returns The first and the last instant of the axis.
 */
export function axisExtent(
  period: ChartPeriod,
  datasets: readonly Dataset[],
  x: string | undefined,
): ChartPeriod {
  const times = datasets.flatMap((dataset) => timesOf(dataset, x));
  return times.reduce<ChartPeriod>(
    (extent, time) => ({ from: Math.min(extent.from, time), to: Math.max(extent.to, time) }),
    period,
  );
}

/**
 * One x axis over an extent, when it is a time axis that sets no bound of its own.
 *
 * @param axis - The axis.
 * @param extent - What it covers.
 * @returns The axis.
 */
function bounded(axis: unknown, extent: ChartPeriod): unknown {
  if (!isObject(axis) || axis.type !== 'time') return axis;
  if (axis.min !== undefined || axis.max !== undefined) return axis;
  return { ...axis, min: extent.from, max: extent.to };
}

/**
 * The option with its time axes over an extent. An axis of categories or values is left alone,
 * and so is a time axis the view bounds itself.
 *
 * @param option - The option.
 * @param extent - What the time axes cover, or `undefined` to leave them to their data.
 * @returns The option.
 */
export function withPeriodAxis(option: Loose, extent: ChartPeriod | undefined): Loose {
  if (extent === undefined || !('xAxis' in option)) return option;
  const { xAxis } = option;
  const axes = Array.isArray(xAxis)
    ? xAxis.map((axis) => bounded(axis, extent))
    : bounded(xAxis, extent);
  return { ...option, xAxis: axes };
}

/**
 * Whether a chart is drawn on one time axis.
 *
 * @param option - The option.
 * @returns `true` when its x axis is a time axis.
 */
export function onTimeAxis(option: Loose): boolean {
  return isObject(option.xAxis) && option.xAxis.type === 'time';
}

/**
 * The time range the time axis of a panel's chart covers, if it covers one. It does when every
 * query the chart draws follows the time range, so the range is what the data is about. A query
 * that names a time of its own, such as a fixed date, ran over something else: its chart is left
 * to its data. So is a chart whose view asks for an axis cut to its data.
 *
 * @param panel - The panel: its view and its queries.
 * @param time - The time range the panel ran over, as the run gives it.
 * @returns The time range, or `undefined` to leave the axis to the data.
 */
export function chartPeriodOf(
  panel: Pick<Panel, 'view' | 'queries'>,
  time: ChartPeriod | undefined,
): ChartPeriod | undefined {
  const { view } = panel;
  if (time === undefined || view.kind !== 'chart' || view.timeAxis === 'data') return undefined;
  const drawn = panel.queries.filter((query) =>
    view.datasets.some((dataset) => dataset.ref === query.refId),
  );
  return drawn.length > 0 && drawn.every(followsTimeRange) ? time : undefined;
}

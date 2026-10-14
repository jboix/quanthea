/**
 * A legend with a value after each series name: the total, the mean, the last or the highest of
 * the series' values, written as the chart's value axis writes its numbers. The spec holds only
 * which value; the formatter is a function this adapter makes.
 */
import type { ChartView, Dataset } from '@quanthea/shared';
import { isObject, type Loose } from './loose.ts';

/** Which value a legend shows for each series. */
export type LegendValue = NonNullable<ChartView['legendValues']>;

/**
 * One value of a list of numbers, the missing ones skipped.
 *
 * @param values - The values, in order.
 * @param kind - Which value.
 * @returns The value; none when no number is there.
 */
export function legendValue(values: readonly unknown[], kind: LegendValue): number | undefined {
  const numbers = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (numbers.length === 0) return undefined;
  const total = numbers.reduce((sum, each) => sum + each, 0);
  if (kind === 'total') return total;
  if (kind === 'mean') return total / numbers.length;
  if (kind === 'last') return numbers.at(-1);
  return Math.max(...numbers);
}

/**
 * The first axis of a kind, from an option's axis or list of axes.
 *
 * @param axis - The option's `xAxis` or `yAxis`.
 * @returns The first axis, if any.
 */
function firstAxis(axis: unknown): Loose | undefined {
  const first = Array.isArray(axis) ? axis[0] : axis;
  return isObject(first) ? first : undefined;
}

/**
 * The column a series reads its values from: `y`, or `x` when the categories run up the y axis.
 *
 * @param series - The series.
 * @param option - The option, for its axes.
 * @returns The column's name, if the series names one.
 */
function valueColumn(series: Loose, option: Loose): string | undefined {
  const encode = isObject(series.encode) ? series.encode : {};
  const horizontal = firstAxis(option.yAxis)?.type === 'category';
  const column = horizontal ? encode.x : encode.y;
  const [name] = [column].flat();
  return typeof name === 'string' ? name : undefined;
}

/**
 * How the value axis writes a number: its label formatter, else the number as it is.
 *
 * @param option - The option, its formatters wired.
 * @returns The writer.
 */
function numberWriter(option: Loose): (value: number) => string {
  const horizontal = firstAxis(option.yAxis)?.type === 'category';
  const axis = firstAxis(horizontal ? option.xAxis : option.yAxis);
  const label = isObject(axis?.axisLabel) ? axis.axisLabel : {};
  const { formatter } = label;
  if (typeof formatter === 'function') return (value) => String(formatter(value, 0));
  return (value) => value.toLocaleString('en', { maximumFractionDigits: 2 });
}

/**
 * One series' value.
 *
 * @param series - The series.
 * @param option - The option, for its axes.
 * @param datasets - The prepared datasets.
 * @param kind - Which value.
 * @returns The value; none when the series reads no column with numbers.
 */
function seriesValue(
  series: Loose,
  option: Loose,
  datasets: readonly Dataset[],
  kind: LegendValue,
): number | undefined {
  const column = valueColumn(series, option);
  const dataset = datasets[typeof series.datasetIndex === 'number' ? series.datasetIndex : 0];
  if (!dataset || column === undefined) return undefined;
  const at = dataset.dimensions.findIndex((dimension) => dimension.name === column);
  return at < 0
    ? undefined
    : legendValue(
        dataset.source.map((row) => row[at]),
        kind,
      );
}

/**
 * Each named series' value, by name.
 *
 * @param option - The option.
 * @param datasets - The prepared datasets.
 * @param kind - Which value.
 * @returns The values, by series name.
 */
function valuesByName(
  option: Loose,
  datasets: readonly Dataset[],
  kind: LegendValue,
): Map<string, number> {
  const found = new Map<string, number>();
  for (const series of [option.series ?? []].flat().filter(isObject)) {
    const value = seriesValue(series, option, datasets, kind);
    if (typeof series.name === 'string' && value !== undefined) found.set(series.name, value);
  }
  return found;
}

/**
 * The option with a value after each series name in its legend, when the view asks for one and the
 * chart has a legend.
 *
 * @param option - The built option, its formatters wired.
 * @param kind - Which value, if the view asks for one.
 * @param datasets - The prepared datasets.
 * @returns The option.
 */
export function withLegendValues(
  option: Loose,
  kind: LegendValue | undefined,
  datasets: readonly Dataset[],
): Loose {
  if (kind === undefined || !isObject(option.legend)) return option;
  const values = valuesByName(option, datasets, kind);
  const write = numberWriter(option);
  const formatter = (name: string) => {
    const value = values.get(name);
    return value === undefined ? name : `${name}  ${write(value)}`;
  };
  return { ...option, legend: { ...option.legend, formatter } };
}

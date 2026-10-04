/**
 * The marks of the alerts linked to a panel, on its time chart: each threshold as a dashed line
 * and the firing periods shaded, both in the danger colour, as the alert's own chart draws them.
 * They join the marks the first series already has, such as the annotation markers.
 */
import { isObject, type Loose } from './loose.ts';
import type { ChartTheme } from './theme.ts';

/** What the alerts linked to a panel draw on its time chart. */
export interface AlertMarks {
  /** Each threshold, with the words of its label. */
  readonly thresholds: readonly { readonly value: number; readonly label: string }[];
  /** When the alerts fired. */
  readonly periods: readonly { readonly from: number; readonly to: number }[];
}

/**
 * The data a mark already has.
 *
 * @param mark - The mark, if any.
 * @returns Its data.
 */
function dataOf(mark: unknown): unknown[] {
  return isObject(mark) && Array.isArray(mark.data) ? mark.data : [];
}

/**
 * The threshold lines, added to the first series' mark line. Their value is exact: a negative
 * precision keeps ECharts from rounding it to two decimals.
 *
 * @param first - The first series.
 * @param marks - The thresholds.
 * @param theme - The theme.
 * @returns The mark line to set, or nothing.
 */
function thresholdLines(first: Loose, marks: AlertMarks, theme: ChartTheme): Loose {
  if (marks.thresholds.length === 0) return {};
  const items = marks.thresholds.map(({ value, label }) => ({
    yAxis: value,
    name: label,
    lineStyle: { color: theme.danger, type: 'dashed', width: 1.5 },
    label: {
      position: 'insideEndTop',
      // A function, so ECharts reads no template in the text.
      formatter: () => label,
      color: theme.danger,
      backgroundColor: 'transparent',
      padding: 0,
    },
  }));
  const base = isObject(first.markLine)
    ? first.markLine
    : { silent: true, animation: false, symbol: ['none', 'none'] };
  const label = { fontFamily: theme.monoFamily, fontSize: 11, ...(base.label as Loose) };
  const data = [...dataOf(first.markLine), ...items];
  return { markLine: { ...base, label, precision: -1, data } };
}

/**
 * The firing periods, added to the first series' shaded areas.
 *
 * @param first - The first series.
 * @param marks - The periods.
 * @param theme - The theme.
 * @returns The mark area to set, or nothing.
 */
function firingAreas(first: Loose, marks: AlertMarks, theme: ChartTheme): Loose {
  if (marks.periods.length === 0) return {};
  const items = marks.periods.map((period) => [
    { xAxis: period.from, itemStyle: { color: theme.danger, opacity: 0.1 } },
    { xAxis: period.to },
  ]);
  const base = isObject(first.markArea) ? first.markArea : { silent: true, animation: false };
  return { markArea: { ...base, data: [...dataOf(first.markArea), ...items] } };
}

/**
 * Adds the linked alerts' thresholds and firing periods to the first series of a time chart.
 *
 * @param series - The series.
 * @param marks - The alerts' marks, if any.
 * @param theme - The theme.
 * @returns The series, the first with the marks.
 */
export function withAlertMarks(
  series: readonly Loose[],
  marks: AlertMarks | undefined,
  theme: ChartTheme,
): Loose[] {
  const [first, ...rest] = series;
  if (!first || !marks) return [...series];
  const marked = {
    ...first,
    ...thresholdLines(first, marks, theme),
    ...firingAreas(first, marks, theme),
  };
  return [marked, ...rest];
}

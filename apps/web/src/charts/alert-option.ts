/**
 * The option of an alert's chart: each series' values over a window, the threshold as a dashed
 * line, and the periods the alert fired shaded, in the danger colour.
 */
import { createFormatter } from '@quanthea/shared';
import type { Loose } from './loose.ts';
import type { ChartTheme } from './theme.ts';

/** A day, in milliseconds. */
const day = 86_400_000;

/** One series of an alert's chart. */
export interface AlertChartSeries {
  /** Its name, for the legend and tooltip. */
  readonly name: string;
  /** Its value at each evaluation. */
  readonly points: readonly { readonly at: number; readonly value: number | null }[];
}

/** What an alert's chart draws. */
export interface AlertChartInput {
  /** The series. */
  readonly series: readonly AlertChartSeries[];
  /** The threshold, or `null` for a condition without one. */
  readonly threshold: number | null;
  /** When the alert fired. */
  readonly firing: readonly { readonly from: number; readonly to: number }[];
  /** Writes a value as the alert's format does. */
  readonly format: (value: number) => string;
  /** The start of the window. */
  readonly from: number;
  /** The end of the window. */
  readonly to: number;
}

/**
 * The threshold line, and the firing periods, on the first series.
 *
 * @param input - The threshold and the periods.
 * @param theme - The theme.
 * @returns The marks to spread on the first series.
 */
function marks(input: AlertChartInput, theme: ChartTheme): Loose {
  const { threshold, firing, format } = input;
  const markArea = {
    silent: true,
    animation: false,
    itemStyle: { color: theme.danger, opacity: 0.1 },
    data: firing.map((period) => [{ xAxis: period.from }, { xAxis: period.to }]),
  };
  if (threshold === null) return { markArea };
  const markLine = {
    silent: true,
    animation: false,
    symbol: ['none', 'none'],
    lineStyle: { color: theme.danger, type: 'dashed', width: 1.5 },
    label: {
      position: 'insideEndTop',
      color: theme.danger,
      fontFamily: theme.monoFamily,
      fontSize: 11,
      formatter: () => format(threshold),
    },
    data: [{ yAxis: threshold }],
  };
  return { markArea, markLine };
}

/**
 * A round step for an axis spanning a range: 1, 2 or 5 times a power of ten.
 *
 * @param span - The range.
 * @returns The step.
 */
function niceStep(span: number): number {
  const raw = span / 5 || 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  if (unit <= 1) return power;
  if (unit <= 2) return 2 * power;
  return unit <= 5 ? 5 * power : 10 * power;
}

/**
 * The bounds of the value axis that keep the threshold in view, rounded, when it lies outside the
 * values; none when it lies among them, so the axis keeps its own round bounds.
 *
 * @param input - The series and the threshold.
 * @returns The `min` or `max` to set, if any.
 */
export function thresholdBounds(input: AlertChartInput): { min?: number; max?: number } {
  const { threshold } = input;
  const values = input.series.flatMap((each) =>
    each.points.flatMap((point) => (point.value === null ? [] : [point.value])),
  );
  if (threshold === null) return {};
  const low = Math.min(threshold, ...values);
  const high = Math.max(threshold, ...values);
  const step = niceStep(high - low || Math.abs(threshold));
  // A round bound past the threshold, a step further when it falls on one.
  if (values.length === 0 || threshold > Math.max(...values))
    return { max: (Math.floor(threshold / step) + 1) * step };
  if (threshold < Math.min(...values)) return { min: (Math.ceil(threshold / step) - 1) * step };
  return {};
}

/**
 * The axes: times in the time zone, values in the alert's format, the threshold always in view.
 *
 * @param input - The window, the threshold and the format.
 * @param theme - The theme.
 * @param timeZone - The IANA time zone, or the browser's.
 * @returns The x and y axes.
 */
function axes(input: AlertChartInput, theme: ChartTheme, timeZone: string | undefined): Loose {
  const pattern = input.to - input.from > day ? 'datetime' : 'time';
  const time = createFormatter({ $fmt: 'datetime', pattern }, { timeZone });
  const label = { color: theme.inkSecondary, fontFamily: theme.monoFamily, fontSize: 11 };
  const bounds = thresholdBounds(input);
  return {
    xAxis: {
      type: 'time',
      min: input.from,
      max: input.to,
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { show: false },
      axisLabel: { ...label, hideOverlap: true, formatter: (value: number) => time(value) },
    },
    yAxis: {
      type: 'value',
      scale: true,
      ...bounds,
      splitLine: { lineStyle: { color: theme.divider } },
      axisLabel: { ...label, formatter: (value: number) => input.format(value) },
    },
  };
}

/**
 * Builds the option of an alert's chart.
 *
 * @param input - The series, threshold, firing periods, format and window.
 * @param theme - The theme.
 * @param timeZone - The IANA time zone, or the browser's.
 * @returns The ECharts option.
 */
export function buildAlertOption(
  input: AlertChartInput,
  theme: ChartTheme,
  timeZone?: string,
): Loose {
  const series = input.series.map((each, index) => ({
    type: 'line',
    name: each.name,
    showSymbol: false,
    data: each.points.map((point) => [point.at, point.value]),
    ...(index === 0 ? marks(input, theme) : {}),
  }));
  return {
    color: [...theme.palette],
    textStyle: { fontFamily: theme.fontFamily, color: theme.inkSecondary },
    animationDuration: 300,
    ...frame(input, theme),
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      textStyle: { color: theme.ink, fontFamily: theme.fontFamily, fontSize: 12 },
      valueFormatter: (value: number | null) => (value === null ? '–' : input.format(value)),
    },
    ...axes(input, theme, timeZone),
    series,
  };
}

/**
 * The room around the plot, the legend when there are several series, and a note when there is
 * no data.
 *
 * @param input - The series.
 * @param theme - The theme.
 * @returns The grid, and the legend or the note when they show.
 */
function frame(input: AlertChartInput, theme: ChartTheme): Loose {
  const several = input.series.length > 1;
  const bounded = { outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' };
  const empty = input.series.every((each) => each.points.every((point) => point.value === null));
  const legend = { top: 0, type: 'scroll', textStyle: { color: theme.inkSecondary } };
  const note = { text: 'No data in this range', left: 'center', top: 'middle' };
  const title = { ...note, textStyle: { color: theme.inkSecondary, fontSize: 13 } };
  return {
    grid: { left: 8, right: 16, top: several ? 36 : 16, bottom: 8, ...bounded },
    ...(several ? { legend } : {}),
    ...(empty ? { title } : {}),
  };
}

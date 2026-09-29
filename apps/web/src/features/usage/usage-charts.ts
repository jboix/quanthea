/** The usage charts: days as frames, drawn by the same chart code as dashboards. */
import type { Formatter, Frame } from '@querent/shared';
import type { ChartInput } from '../../charts/index.ts';
import type { DayUsage } from './usage-days.ts';

/** A series of the chart: its name and how a day gives its value. */
type Series = readonly [name: string, value: (day: DayUsage) => number];

/**
 * The days as one frame: a time field and one number field per series.
 *
 * @param days - The days.
 * @param series - The series.
 * @returns The frame.
 */
function frameOf(days: readonly DayUsage[], series: readonly Series[]): Frame {
  return {
    refId: 'A',
    fields: [
      { name: 'time', type: 'time' },
      ...series.map(([name]) => ({ name, type: 'number' as const })),
    ],
    values: [days.map((day) => day.day), ...series.map(([, value]) => days.map(value))],
    meta: { rowCount: days.length, truncated: false, durationMs: 0 },
  };
}

/**
 * Bars per day, stacked when there are several series.
 *
 * @param days - The days.
 * @param series - The series.
 * @param format - How the values read.
 * @returns The chart input.
 */
function barsPerDay(
  days: readonly DayUsage[],
  series: readonly Series[],
  format: Formatter,
): ChartInput {
  const option = {
    xAxis: {
      type: 'time',
      axisLabel: { formatter: { $fmt: 'datetime', pattern: 'date' }, hideOverlap: true },
    },
    yAxis: { type: 'value', axisLabel: { formatter: format } },
    tooltip: { trigger: 'axis' },
    ...(series.length > 1 ? { legend: { top: 0, right: 0 } } : {}),
    series: [{ type: 'bar', stack: 'day' }],
  };
  return {
    view: {
      kind: 'chart',
      prepare: 'cartesian',
      roles: {},
      datasets: [{ ref: 'A' }],
      option: option as ChartInput['view']['option'],
    },
    queries: [{ refId: 'A', frames: [frameOf(days, series)], error: null }],
    markers: [],
  };
}

/**
 * Tokens per day: fresh input, cache reads and output, stacked.
 *
 * @param days - The days.
 * @returns The chart input.
 */
export function tokensChart(days: readonly DayUsage[]): ChartInput {
  const series: Series[] = [
    ['Fresh input', (day) => day.input],
    ['Cached input', (day) => day.cached],
    ['Output', (day) => day.output],
  ];
  return barsPerDay(days, series, { $fmt: 'number', compact: true });
}

/**
 * The list-price cost per day.
 *
 * @param days - The days.
 * @returns The chart input.
 */
export function costChart(days: readonly DayUsage[]): ChartInput {
  const format: Formatter = { $fmt: 'currency', code: 'USD', decimals: 3 };
  return barsPerDay(days, [['Cost', (day) => day.dollars]], format);
}

/**
 * Views of pinned dashboards per day.
 *
 * @param days - The days.
 * @returns The chart input.
 */
export function viewsChart(days: readonly DayUsage[]): ChartInput {
  return barsPerDay(days, [['Views', (day) => day.views]], { $fmt: 'number', decimals: 0 });
}

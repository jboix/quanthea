/** The usage charts: days as frames, drawn by the same chart code as dashboards. */
import { datasetOfFrames, type Formatter, type Frame } from '@quanthea/shared';
import type { ChartInput } from '../../charts/index.ts';
import type { chartedModels, DaySpend, DayUsage } from './usage-days.ts';
import { featureNames, usageFeatures } from './usage-features.ts';

/** How the token and cost charts split each day: by model, or by feature. */
export type UsageSplit = 'model' | 'feature';

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
 * @param whole - Whether the values are counts, with ticks on whole numbers only.
 * @returns The chart input.
 */
function barsPerDay(
  days: readonly DayUsage[],
  series: readonly Series[],
  format: Formatter,
  whole = false,
): ChartInput {
  const option = {
    xAxis: {
      type: 'time',
      axisLabel: { formatter: { $fmt: 'datetime', pattern: 'date' }, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      // Counts of whole things, such as views, never get a tick between two whole numbers.
      ...(whole ? { minInterval: 1 } : {}),
      axisLabel: { formatter: format },
    },
    tooltip: { trigger: 'axis' },
    ...(series.length > 1 ? { legend: { top: 0, right: 0, type: 'scroll' } } : {}),
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
    datasets: [datasetOfFrames([frameOf(days, series)])],
    markers: [],
  };
}

/** The models a chart draws one by one, and whether `Other` gathers the rest. */
type Charted = ReturnType<typeof chartedModels>;

/**
 * One series per charted model, and `Other` for the rest.
 *
 * @param charted - The models drawn one by one, and whether others exist.
 * @param measure - What a series adds up: tokens or dollars.
 * @returns The series.
 */
function modelSeries(charted: Charted, measure: keyof DaySpend): Series[] {
  const shown = new Set(charted.shown);
  const series: Series[] = charted.shown.map((model) => [
    model,
    (day) => day.byModel[model]?.[measure] ?? 0,
  ]);
  if (!charted.other) return series;
  const rest = (day: DayUsage) =>
    Object.entries(day.byModel)
      .filter(([model]) => !shown.has(model))
      .reduce((sum, [, used]) => sum + (used?.[measure] ?? 0), 0);
  return [...series, ['Other', rest]];
}

/**
 * One series per feature, every feature always, so each keeps its colour from one range to the
 * next.
 *
 * @param measure - What a series adds up: tokens or dollars.
 * @returns The series.
 */
function featureSeries(measure: keyof DaySpend): Series[] {
  return usageFeatures.map((feature) => [
    featureNames[feature],
    (day) => day.byFeature[feature]?.[measure] ?? 0,
  ]);
}

/**
 * The series of a split.
 *
 * @param split - By model or by feature.
 * @param charted - The models drawn one by one, for the split by model.
 * @param measure - What a series adds up.
 * @returns The series.
 */
function splitSeries(split: UsageSplit, charted: Charted, measure: keyof DaySpend): Series[] {
  return split === 'feature' ? featureSeries(measure) : modelSeries(charted, measure);
}

/**
 * Tokens per day, stacked by model or by feature.
 *
 * @param days - The days.
 * @param charted - The models drawn one by one.
 * @param split - By model or by feature.
 * @returns The chart input.
 */
export function tokensChart(
  days: readonly DayUsage[],
  charted: Charted,
  split: UsageSplit = 'model',
): ChartInput {
  const format: Formatter = { $fmt: 'number', compact: true };
  return barsPerDay(days, splitSeries(split, charted, 'tokens'), format);
}

/**
 * The list-price cost per day, stacked by model or by feature.
 *
 * @param days - The days.
 * @param charted - The models drawn one by one.
 * @param split - By model or by feature.
 * @returns The chart input.
 */
export function costChart(
  days: readonly DayUsage[],
  charted: Charted,
  split: UsageSplit = 'model',
): ChartInput {
  const format: Formatter = { $fmt: 'currency', code: 'USD', decimals: 3 };
  return barsPerDay(days, splitSeries(split, charted, 'dollars'), format);
}

/**
 * Views of pinned dashboards per day.
 *
 * @param days - The days.
 * @returns The chart input.
 */
export function viewsChart(days: readonly DayUsage[]): ChartInput {
  return barsPerDay(days, [['Views', (day) => day.views]], { $fmt: 'number', decimals: 0 }, true);
}

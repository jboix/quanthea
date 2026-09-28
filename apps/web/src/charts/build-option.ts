/**
 * Builds the ECharts option of a chart panel from its spec and its query results. The spec
 * provides the look; the adapter owns the dataset, the grid, the theme and how tooltips render.
 */
import type { ChartView, MarkerOutcome, QueryOutcome } from '@querent/shared';
import { wireFormatters } from './formatters.ts';
import { expandSeries, isObject, type Loose, withMarkers } from './series.ts';
import { type Table, tableOf, transformTable } from './tables.ts';
import type { ChartTheme } from './theme.ts';

/** What a chart draws. */
export interface ChartInput {
  /** The chart view from the spec. */
  readonly view: ChartView;
  /** The outcome of each query of the panel. */
  readonly queries: readonly QueryOutcome[];
  /** The annotation markers of the panel. */
  readonly markers: readonly MarkerOutcome[];
}

/** How a chart looks. */
export interface ChartContext {
  /** The theme. */
  readonly theme: ChartTheme;
  /** The IANA time zone for times, or the browser's. */
  readonly timeZone?: string | undefined;
}

/**
 * Merges two objects deeply; the second wins.
 *
 * @param base - The defaults.
 * @param over - The overrides.
 * @returns The merged object.
 */
function merge(base: Loose, over: unknown): Loose {
  if (!isObject(over)) return base;
  const merged: Loose = { ...base };
  for (const [key, value] of Object.entries(over)) {
    merged[key] = isObject(value) && isObject(base[key]) ? merge(base[key] as Loose, value) : value;
  }
  return merged;
}

/**
 * Styles one axis or a list of axes with the theme, under the spec's own settings.
 *
 * @param axis - The spec's axis, if any.
 * @param defaults - The themed defaults.
 * @returns The styled axis or axes.
 */
function styleAxis(axis: unknown, defaults: Loose): unknown {
  if (Array.isArray(axis)) return axis.map((each) => merge(defaults, each));
  return merge(defaults, axis);
}

/**
 * The themed axis defaults. A time axis reads `13:30` in the dashboard's time zone.
 *
 * @param theme - The theme.
 * @param axis - The spec's axis, to see whether it is a time axis.
 * @returns The defaults.
 */
function axisDefaults(theme: ChartTheme, axis: unknown): Loose {
  const timeAxis = isObject(axis) && axis.type === 'time';
  return {
    axisLine: { lineStyle: { color: theme.border } },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: theme.divider } },
    axisLabel: {
      color: theme.inkSecondary,
      fontFamily: theme.monoFamily,
      fontSize: 11,
      ...(timeAxis ? { formatter: { $fmt: 'datetime', pattern: 'time' } } : {}),
    },
  };
}

/**
 * The tables of each spec dataset, transformed.
 *
 * @param input - The view and the query outcomes.
 * @returns One list of tables per spec dataset.
 */
function datasetGroups(input: ChartInput): Table[][] {
  return input.view.datasets.map((dataset) => {
    const frames = input.queries.find((query) => query.refId === dataset.ref)?.frames ?? [];
    return frames.map((frame) => transformTable(tableOf(frame), dataset.transform));
  });
}

/**
 * The tooltip: the spec's, rendered as rich text on the canvas so no data can become HTML.
 *
 * @param spec - The spec's tooltip, if any.
 * @param series - The expanded series, to pick the trigger.
 * @param theme - The theme.
 * @returns The tooltip.
 */
function tooltipOf(spec: unknown, series: readonly Loose[], theme: ChartTheme): Loose {
  const itemChart = series.some((each) => each.type === 'pie' || each.type === 'gauge');
  const defaults = {
    trigger: itemChart ? 'item' : 'axis',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    textStyle: { color: theme.ink, fontFamily: theme.fontFamily, fontSize: 12 },
  };
  return { ...merge(defaults, spec), renderMode: 'richText', confine: true };
}

/**
 * The spec's option with the theme applied under it, and the expanded series.
 *
 * @param option - The spec's option.
 * @param series - The expanded series.
 * @param theme - The theme.
 * @returns The styled option, still with named formatters.
 */
function styleOption(option: Loose, series: readonly Loose[], theme: ChartTheme): Loose {
  const legendDefaults = {
    textStyle: { color: theme.inkSecondary },
    icon: 'roundRect',
    itemWidth: 12,
    itemHeight: 3,
  };
  return {
    ...option,
    xAxis: styleAxis(option.xAxis, axisDefaults(theme, option.xAxis)),
    yAxis: styleAxis(option.yAxis, axisDefaults(theme, option.yAxis)),
    ...(option.legend ? { legend: merge(legendDefaults, option.legend) } : {}),
    series,
    tooltip: tooltipOf(option.tooltip, series, theme),
  };
}

/**
 * The parts the adapter owns: the data, the palette, the fonts, the grid and the animation.
 *
 * @param tables - The tables, one ECharts dataset each.
 * @param theme - The theme.
 * @param hasLegend - Whether the chart shows a legend, which needs room at the top.
 * @returns The owned parts.
 */
function ownedParts(tables: readonly Table[], theme: ChartTheme, hasLegend: boolean): Loose {
  return {
    dataset: tables.map((table) => ({
      dimensions: table.fields.map((field) => field.name),
      source: table.rows,
    })),
    color: [...theme.palette],
    textStyle: { fontFamily: theme.fontFamily, color: theme.inkSecondary },
    grid: {
      left: 8,
      right: 16,
      top: hasLegend ? 36 : 16,
      bottom: 8,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    animationDuration: 300,
  };
}

/**
 * Builds the option.
 *
 * @param input - The view, the query outcomes and the markers.
 * @param context - The theme and the time zone.
 * @returns The ECharts option.
 */
export function buildChartOption(input: ChartInput, context: ChartContext): Loose {
  const { option } = input.view;
  const groups = datasetGroups(input);
  const horizontal = isObject(option.yAxis) && option.yAxis.type === 'category';
  const expanded = expandSeries(option.series, groups, horizontal);
  const series = horizontal
    ? expanded
    : withMarkers(expanded, input.markers, context.theme, context.timeZone);
  const styled = styleOption(option, series, context.theme);
  return {
    ...(wireFormatters(styled, { timeZone: context.timeZone }) as Loose),
    ...ownedParts(groups.flat(), context.theme, Boolean(option.legend)),
  };
}

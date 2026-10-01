/**
 * Builds the ECharts option of a chart panel from its view and its data. The view gives the look,
 * how the data is prepared and which column plays each role; the adapter owns the dataset, the
 * grid, the theme and how tooltips render.
 */
import type { ChartView, Dataset, MarkerOutcome, QueryOutcome } from '@quanthea/shared';
import { viewDatasets } from './datasets.ts';
import { wireFormatters } from './formatters.ts';
import { isObject, type Loose } from './loose.ts';
import { type Prepared, prepareChart } from './prepare/index.ts';
import { oneColumn } from './roles.ts';
import { expandSeries, withMarkers } from './series.ts';
import type { ChartTheme } from './theme.ts';
import { replaceTokens, themeColors } from './tokens.ts';

/** What a chart draws. */
export interface ChartInput {
  /** The chart view from the spec. */
  readonly view: ChartView;
  /** The view's datasets, one per query it reads. */
  readonly datasets: readonly Dataset[];
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
 * What a chart draws from a panel's run.
 *
 * @param view - The chart view.
 * @param queries - The outcome of each query of the panel.
 * @param markers - The annotation markers.
 * @returns The input.
 */
export function chartInputOf(
  view: ChartView,
  queries: readonly QueryOutcome[],
  markers: readonly MarkerOutcome[],
): ChartInput {
  return { view, datasets: viewDatasets(view, queries), markers };
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

/** A day, in milliseconds. */
const day = 86_400_000;

/** A time label pattern. */
type TimePattern = 'time' | 'date' | 'datetime';

/**
 * The time label pattern that fits the data: dates when points are a day or more apart, dates and
 * hours over several days, hours within a day.
 *
 * @param dataset - The main dataset.
 * @returns The pattern.
 */
function timePattern(dataset: Dataset | undefined): TimePattern {
  const at = dataset?.dimensions.findIndex((column) => column.type === 'time') ?? -1;
  const times = [...new Set((dataset?.source ?? []).map((row) => row[at]))]
    .filter((cell): cell is number => typeof cell === 'number')
    .sort((a, b) => a - b);
  const gaps = times.slice(1).map((time, index) => time - (times[index] ?? time));
  if (gaps.length > 0 && gaps.every((gap) => gap >= day)) return 'date';
  const span = (times.at(-1) ?? 0) - (times[0] ?? 0);
  return span > day ? 'datetime' : 'time';
}

/**
 * Styles one axis or a list of axes with the theme, under the view's own settings. A time axis
 * reads hours or dates in the dashboard's time zone.
 *
 * @param axis - The view's axis or axes.
 * @param theme - The theme.
 * @param pattern - The time label pattern.
 * @param timeCategories - Whether category axes hold times, as bars per day do.
 * @returns The styled axis or axes.
 */
function styleAxis(
  axis: unknown,
  theme: ChartTheme,
  pattern: TimePattern,
  timeCategories: boolean,
): unknown {
  if (Array.isArray(axis))
    return axis.map((each) => styleAxis(each, theme, pattern, timeCategories));
  const type = isObject(axis) ? axis.type : undefined;
  const timeAxis = type === 'time' || (type === 'category' && timeCategories);
  const defaults = {
    axisLine: { lineStyle: { color: theme.border } },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: theme.divider } },
    axisLabel: {
      color: theme.inkSecondary,
      fontFamily: theme.monoFamily,
      fontSize: 11,
      hideOverlap: true,
      ...(timeAxis ? { formatter: { $fmt: 'datetime', pattern } } : {}),
    },
  };
  return merge(defaults, axis);
}

/**
 * The tooltip: the view's, rendered as rich text on the canvas so no data can become HTML.
 *
 * @param spec - The view's tooltip, if any.
 * @param series - The series, to pick the trigger.
 * @param theme - The theme.
 * @returns The tooltip.
 */
function tooltipOf(spec: unknown, series: readonly Loose[], theme: ChartTheme): Loose {
  const onAxes = series.some((each) => each.type === 'line' || each.type === 'bar');
  const defaults = {
    trigger: onAxes ? 'axis' : 'item',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    textStyle: { color: theme.ink, fontFamily: theme.fontFamily, fontSize: 12 },
  };
  return { ...merge(defaults, spec), renderMode: 'richText', confine: true };
}

/**
 * The option styled with the theme: axes and legends only where the chart has them.
 *
 * @param option - The option, tokens replaced.
 * @param theme - The theme.
 * @param dataset - The main dataset, for the time labels.
 * @param timeCategories - Whether category axes hold times.
 * @returns The styled option.
 */
function styleOption(
  option: Loose,
  theme: ChartTheme,
  dataset: Dataset | undefined,
  timeCategories: boolean,
): Loose {
  const pattern = timePattern(dataset);
  const series = [option.series ?? []].flat().filter(isObject);
  const legendDefaults = {
    top: 0,
    left: 'center',
    textStyle: { color: theme.inkSecondary },
    icon: 'roundRect',
    itemWidth: 12,
    itemHeight: 3,
    type: 'scroll',
  };
  const showLegend =
    option.legend !== undefined && series.length + (series[0]?.type === 'pie' ? 2 : 0) > 1;
  const { legend: _legend, ...rest } = option;
  return {
    ...rest,
    ...('xAxis' in option
      ? { xAxis: styleAxis(option.xAxis, theme, pattern, timeCategories) }
      : {}),
    ...('yAxis' in option
      ? { yAxis: styleAxis(option.yAxis, theme, pattern, timeCategories) }
      : {}),
    ...(showLegend ? { legend: merge(legendDefaults, option.legend) } : {}),
    tooltip: tooltipOf(option.tooltip, series, theme),
  };
}

/**
 * Room around the plot: for the legend at the top, and for a colour scale or a zoom slider below.
 *
 * @param option - The styled option.
 * @returns The grid.
 */
function gridOf(option: Loose): Loose {
  const visualMap = isObject(option.visualMap) ? option.visualMap : undefined;
  const scaleBelow = visualMap && visualMap.show !== false && visualMap.orient === 'horizontal';
  const slider = [option.dataZoom ?? []]
    .flat()
    .some((zoom) => isObject(zoom) && zoom.type === 'slider');
  const title = isObject(option.title) && typeof option.title.text === 'string';
  return {
    left: 8,
    right: 16,
    top: (option.legend ? 36 : 16) + (title ? 40 : 0),
    bottom: 8 + (scaleBelow ? 36 : 0) + (slider ? 28 : 0),
    outerBoundsMode: 'same',
    outerBoundsContain: 'axisLabel',
  };
}

/**
 * The parts the adapter owns: the data, the palette, the fonts, the grid and the animation, and a
 * note when there is no data.
 *
 * @param prepared - The prepared data.
 * @param option - The styled option.
 * @param theme - The theme.
 * @param empty - Whether the query returned no rows.
 * @returns The owned parts.
 */
function ownedParts(prepared: Prepared, option: Loose, theme: ChartTheme, empty: boolean): Loose {
  const note = {
    text: 'No data in this range',
    left: 'center',
    top: 'middle',
    textStyle: { color: theme.inkSecondary, fontSize: 13, fontWeight: 400 },
  };
  return {
    dataset: prepared.datasets.map((dataset) => ({
      dimensions: dataset.dimensions.map((column) => column.name),
      source: dataset.source,
    })),
    color: [...theme.palette],
    textStyle: { fontFamily: theme.fontFamily, color: theme.inkSecondary },
    grid: prepared.grid ?? gridOf(option),
    animationDuration: 300,
    ...(empty ? { title: note } : {}),
  };
}

/**
 * The option with its series expanded, the markers on a time chart, and the tokens replaced.
 *
 * @param prepared - The prepared data and option.
 * @param markers - The annotation markers.
 * @param context - The theme and the time zone.
 * @returns The resolved option.
 */
function resolvedOption(
  prepared: Prepared,
  markers: readonly MarkerOutcome[],
  context: ChartContext,
): Loose {
  const expanded = expandSeries(prepared);
  const onTime = isObject(prepared.option.xAxis) && prepared.option.xAxis.type === 'time';
  const series = onTime
    ? withMarkers(expanded, markers, context.theme, context.timeZone)
    : expanded;
  const tokens = {
    colors: themeColors(context.theme),
    roles: prepared.roles,
    dataset: prepared.datasets[0],
  };
  return replaceTokens({ ...prepared.option, series }, tokens) as Loose;
}

/**
 * Builds the option.
 *
 * @param input - The view, the datasets and the markers.
 * @param context - The theme and the time zone.
 * @returns The ECharts option.
 */
export function buildChartOption(input: ChartInput, context: ChartContext): Loose {
  const { view } = input;
  const format = { timeZone: context.timeZone };
  const option = view.option as Loose;
  const prepared = prepareChart(view.prepare, {
    option,
    datasets: input.datasets,
    roles: view.roles,
    limit: view.limit,
    format,
  });
  const resolved = resolvedOption(prepared, input.markers, context);
  const [main] = prepared.datasets;
  const x = oneColumn(prepared.roles, 'x');
  const timeCategories = main?.dimensions.find((column) => column.name === x)?.type === 'time';
  const styled = styleOption(resolved, context.theme, main, timeCategories);
  const empty = input.datasets.every((dataset) => dataset.source.length === 0);
  return {
    ...(wireFormatters(styled, format) as Loose),
    ...ownedParts(prepared, styled, context.theme, empty),
  };
}

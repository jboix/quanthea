/**
 * Builds the ECharts option of a chart panel from its view and its data. The view gives the look,
 * how the data is prepared and which column plays each role; the adapter owns the dataset, the
 * grid, the theme and how tooltips render.
 */
import type { ChartView, Dataset, MarkerOutcome, QueryOutcome, ValueColor } from '@quanthea/shared';
import { type AlertMarks, withAlertMarks } from './alert-marks.ts';
import { viewDatasets } from './datasets.ts';
import { withDensity } from './dense.ts';
import { wireFormatters } from './formatters.ts';
import { hasNoPoint, withHolesShown, withLonePointsShown } from './gaps.ts';
import { withoutLinks } from './links.ts';
import { isObject, type Loose } from './loose.ts';
import { axisExtent, type ChartPeriod, onTimeAxis, withPeriodAxis } from './period-axis.ts';
import { type Prepared, prepareChart } from './prepare/index.ts';
import { oneColumn } from './roles.ts';
import { expandSeries, withHighlights, withMarkers } from './series.ts';
import type { ChartTheme } from './theme.ts';
import { replaceTokens, themeColors } from './tokens.ts';
import { withValueColors } from './value-colors.ts';

/** A window to shade on a time chart, such as one an answer cites, numbered as it is cited. */
export interface ChartHighlight {
  /** The number shown on it. */
  readonly n: number;
  /** The start, in epoch milliseconds. */
  readonly from: number;
  /** The end, in epoch milliseconds. */
  readonly to: number;
}

/** What a chart draws. */
export interface ChartInput {
  /** The chart view from the spec. */
  readonly view: ChartView;
  /** The view's datasets, one per query it reads. */
  readonly datasets: readonly Dataset[];
  /** The annotation markers of the panel. */
  readonly markers: readonly MarkerOutcome[];
  /** Windows to shade, on a time chart only. */
  readonly highlights?: readonly ChartHighlight[] | undefined;
  /** The thresholds and firing periods of the alerts linked to the panel, on a time chart only. */
  readonly alertMarks?: AlertMarks | undefined;
  /**
   * The time range the panel ran over, as the server resolved it, when the time axis covers it
   * (`chartPeriodOf`). Without it the axis is left to the data.
   */
  readonly period?: ChartPeriod | undefined;
  /** The dashboard's colour per value, for the series named after one. */
  readonly colors?: readonly ValueColor[] | undefined;
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
 * @param highlights - Windows to shade, if any.
 * @param alertMarks - The linked alerts' thresholds and firing periods, if any.
 * @returns The input.
 */
export function chartInputOf(
  view: ChartView,
  queries: readonly QueryOutcome[],
  markers: readonly MarkerOutcome[],
  highlights?: readonly ChartHighlight[],
  alertMarks?: AlertMarks,
): ChartInput {
  return { view, datasets: viewDatasets(view, queries), markers, highlights, alertMarks };
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
 * The time label pattern that fits the axis: dates when points are a day or more apart, dates and
 * hours over several days, hours within a day.
 *
 * @param dataset - The main dataset.
 * @param extent - What the time axis covers, when it covers the panel's time range.
 * @returns The pattern.
 */
function timePattern(dataset: Dataset | undefined, extent: ChartPeriod | undefined): TimePattern {
  const at = dataset?.dimensions.findIndex((column) => column.type === 'time') ?? -1;
  const times = [...new Set((dataset?.source ?? []).map((row) => row[at]))]
    .filter((cell): cell is number => typeof cell === 'number')
    .sort((a, b) => a - b);
  const gaps = times.slice(1).map((time, index) => time - (times[index] ?? time));
  if (gaps.length > 0 && gaps.every((gap) => gap >= day)) return 'date';
  const span = extent ? extent.to - extent.from : (times.at(-1) ?? 0) - (times[0] ?? 0);
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
 * A series whose labels get their halo in the surface colour, and the ink colour outside shapes,
 * so text drawn over lines and bars stays readable in either scheme. What the recipe sets stays.
 *
 * @param series - The series.
 * @param theme - The theme.
 * @returns The series.
 */
function withLabelHalo(series: Loose, theme: ChartTheme): Loose {
  const label = series.label;
  if (!isObject(label) || label.show === false || 'textBorderColor' in label) return series;
  // A label inside a shape keeps the colour ECharts picks against the shape's fill.
  const inside = typeof label.position === 'string' && label.position.startsWith('inside');
  const ink = inside ? {} : { color: theme.ink };
  return { ...series, label: { ...ink, textBorderColor: theme.surface, ...label } };
}

/**
 * The option styled with the theme: axes and legends only where the chart has them.
 *
 * @param option - The option, tokens replaced.
 * @param theme - The theme.
 * @param dataset - The main dataset, for the time labels.
 * @param timeCategories - Whether category axes hold times.
 * @param extent - What the time axis covers, when it covers the panel's time range.
 * @returns The styled option.
 */
function styleOption(
  option: Loose,
  theme: ChartTheme,
  dataset: Dataset | undefined,
  timeCategories: boolean,
  extent?: ChartPeriod,
): Loose {
  const pattern = timePattern(dataset, extent);
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
    ...('series' in option ? { series: series.map((each) => withLabelHalo(each, theme)) } : {}),
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
 * The option with its series expanded and coloured by value, the markers, the highlights and the
 * linked alerts' marks on a time chart, a dot on each point no line reaches, and the tokens
 * replaced.
 *
 * @param prepared - The prepared data and option.
 * @param input - The annotation markers, the windows to shade, the alerts' marks and the colours.
 * @param context - The theme and the time zone.
 * @returns The resolved option.
 */
function resolvedOption(
  prepared: Prepared,
  input: Pick<ChartInput, 'markers' | 'highlights' | 'alertMarks' | 'colors'>,
  context: ChartContext,
): Loose {
  const { theme } = context;
  const expanded = withValueColors(expandSeries(prepared), input.colors, theme);
  const onTime = onTimeAxis(prepared.option);
  const marked = withMarkers(expanded, input.markers, theme, context.timeZone);
  const highlighted = withHighlights(marked, input.highlights ?? [], theme);
  const alerted = withAlertMarks(highlighted, input.alertMarks, theme);
  const series = onTime ? withLonePointsShown(alerted, prepared.datasets) : expanded;
  const tokens = {
    colors: themeColors(context.theme),
    roles: prepared.roles,
    dataset: prepared.datasets[0],
  };
  return replaceTokens({ ...prepared.option, series }, tokens) as Loose;
}

/**
 * Whether a chart has no point at all to draw: no row, or on a time chart only missing values, as
 * an average over a time range with no data gives.
 *
 * @param input - The view's datasets.
 * @param prepared - The prepared data.
 * @returns `true` when the chart says there is no data.
 */
function nothingToDraw(input: ChartInput, prepared: Prepared): boolean {
  if (input.datasets.every((dataset) => dataset.source.length === 0)) return true;
  const [main] = prepared.datasets;
  const x = oneColumn(prepared.roles, 'x');
  if (!main || !x || prepared.expanded || !onTimeAxis(prepared.option)) return false;
  return hasNoPoint(main, x);
}

/**
 * Builds the option. The time axis runs over the time range the panel ran over, when the input
 * gives one (`period-axis.ts`), and a stretch without data shows as a gap (`gaps.ts`).
 *
 * @param input - The view, the datasets, the markers and the time range.
 * @param context - The theme and the time zone.
 * @returns The ECharts option, drawn as its number of points asks (`dense.ts`).
 */
export function buildChartOption(input: ChartInput, context: ChartContext): Loose {
  const { view, period } = input;
  const format = { timeZone: context.timeZone };
  const option = withoutLinks(view.option as Loose);
  const prepared = withHolesShown(
    prepareChart(view.prepare, {
      option,
      datasets: input.datasets,
      roles: view.roles,
      limit: view.limit,
      format,
      mappings: view.mappings,
    }),
  );
  const [main] = prepared.datasets;
  const x = oneColumn(prepared.roles, 'x');
  const extent = period && axisExtent(period, [...prepared.datasets, ...input.datasets], x);
  const resolved = withPeriodAxis(resolvedOption(prepared, input, context), extent);
  const timeCategories = main?.dimensions.find((column) => column.name === x)?.type === 'time';
  const styled = styleOption(resolved, context.theme, main, timeCategories, extent);
  return withDensity({
    ...(wireFormatters(styled, format) as Loose),
    ...ownedParts(prepared, styled, context.theme, nothingToDraw(input, prepared)),
  });
}

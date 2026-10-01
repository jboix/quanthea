/**
 * Checks a chart's ECharts option against an allowlist. The adapter owns the dataset, the grid,
 * the theme, animation and how tooltips render, so the spec may not set them, and data is never
 * inlined in a series: the adapter builds it from the queries, trees and graphs included.
 */
import { namedFormatterSchema } from '@quanthea/shared';
import type { SpecIssue } from './issues.ts';

/** The top-level keys an option may have. */
const allowedKeys: ReadonlySet<string> = new Set([
  'xAxis',
  'yAxis',
  'series',
  'legend',
  'tooltip',
  'visualMap',
  'dataZoom',
  'axisPointer',
  'title',
  'radar',
  'parallel',
  'geo',
  'calendar',
]);

/** The series types a chart may draw. */
const allowedSeriesTypes: ReadonlySet<string> = new Set([
  'line',
  'bar',
  'scatter',
  'pie',
  'heatmap',
  'gauge',
  'boxplot',
  'candlestick',
  'treemap',
  'sunburst',
  'sankey',
  'graph',
  'funnel',
  'radar',
  'parallel',
  'map',
]);

/** Keys the adapter owns wherever they appear. */
const adapterKeys: ReadonlySet<string> = new Set(['renderMode', 'appendToBody', 'className']);

/** The longest string an option may hold: a cheap guard against smuggled payloads. */
const maxStringLength = 500;

/** A JSON value inside an option. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Checks one value and everything below it.
 *
 * @param value - The value.
 * @param path - Its path.
 * @param issues - Receives the problems.
 */
function checkValue(value: Json, path: string, issues: SpecIssue[]): void {
  if (typeof value === 'string' && value.length > maxStringLength) {
    issues.push({ path, message: `Strings are at most ${maxStringLength} characters.` });
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) checkValue(item, `${path}[${index}]`, issues);
  } else if (typeof value === 'object' && value !== null) {
    checkObject(value, path, issues);
  }
}

/**
 * Checks an object: named formatters must be valid, and adapter-owned keys are refused.
 *
 * @param value - The object.
 * @param path - Its path.
 * @param issues - Receives the problems.
 */
function checkObject(value: { [key: string]: Json }, path: string, issues: SpecIssue[]): void {
  if ('$fmt' in value && !namedFormatterSchema.safeParse(value).success) {
    issues.push({ path, message: 'Not a valid named formatter.' });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (adapterKeys.has(key))
      issues.push({ path: `${path}.${key}`, message: 'The renderer sets this.' });
    else checkValue(child, `${path}.${key}`, issues);
  }
}

/**
 * Checks one series: an allowed type, and no inlined data.
 *
 * @param item - The series.
 * @param path - Its path.
 * @param issues - Receives the problems.
 */
function checkSeriesItem(item: Json, path: string, issues: SpecIssue[]): void {
  const entry = typeof item === 'object' && item !== null && !Array.isArray(item) ? item : {};
  const type = String(entry.type);
  if (!allowedSeriesTypes.has(type))
    issues.push({ path: `${path}.type`, message: `Series type "${type}" is not supported.` });
  if ('data' in entry)
    issues.push({ path: `${path}.data`, message: 'Data comes from the queries, never inlined.' });
}

/**
 * Checks the series, one object or a list of them.
 *
 * @param series - The `series` value.
 * @param path - Its path.
 * @param issues - Receives the problems.
 */
function checkSeries(series: Json, path: string, issues: SpecIssue[]): void {
  if (!Array.isArray(series)) {
    checkSeriesItem(series, path, issues);
    return;
  }
  for (const [index, item] of series.entries()) checkSeriesItem(item, `${path}[${index}]`, issues);
}

/**
 * Checks a chart option.
 *
 * @param option - The option, as the schema parsed it.
 * @param path - Its path, such as `panels[1].view.option`.
 * @returns The issues.
 */
export function checkOption(option: Readonly<Record<string, Json>>, path: string): SpecIssue[] {
  const issues: SpecIssue[] = [];
  for (const [key, value] of Object.entries(option)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: `"${key}" is not allowed in a chart option.`,
      });
      continue;
    }
    if (key === 'series') checkSeries(value, `${path}.series`, issues);
    checkValue(value, `${path}.${key}`, issues);
  }
  if (!('series' in option))
    issues.push({ path: `${path}.series`, message: 'A chart needs a series.' });
  return issues;
}

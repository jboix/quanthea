/**
 * The views recipes produce: time charts, category bars and pies, stats and tables, with the
 * formatter each unit reads with.
 */
import type { Formatter, View } from '@querent/shared';
import type { Unit } from './request.ts';

/** How a stat reduces a result to one number. */
type StatReduce = Extract<View, { kind: 'stat' }>['reduce'];

/** The formatter of each unit. */
const formatters: Readonly<Record<Unit, Formatter>> = {
  number: { $fmt: 'number', compact: true },
  percent: { $fmt: 'percent', decimals: 1, input: 'ratio' },
  bytes: { $fmt: 'bytes' },
  seconds: { $fmt: 'duration', unit: 's' },
  milliseconds: { $fmt: 'duration', unit: 'ms' },
  'per-second': '{value}/s',
  EUR: { $fmt: 'currency', code: 'EUR' },
  USD: { $fmt: 'currency', code: 'USD' },
};

/**
 * The formatter of a unit.
 *
 * @param unit - The unit.
 * @returns The formatter.
 */
export function formatterOf(unit: Unit): Formatter {
  return formatters[unit];
}

/**
 * A chart over time: one line or bar series per result series, deploy markers added later.
 *
 * @param refs - The query refIds, one dataset each.
 * @param kind - Lines or bars.
 * @param unit - How the values read.
 * @param pivotBy - A column whose values become series, for long SQL results.
 * @returns The view.
 */
export function timeChart(
  refs: readonly string[],
  kind: 'line' | 'bar',
  unit: Unit,
  pivotBy?: string,
): View {
  const transform =
    pivotBy === undefined ? {} : { transform: { type: 'pivot' as const, by: pivotBy } };
  return {
    kind: 'chart',
    prepare: 'cartesian',
    roles: {},
    datasets: refs.map((ref) => ({ ref, ...transform })),
    option: {
      xAxis: { type: 'time' },
      yAxis: { type: 'value', axisLabel: { formatter: formatterOf(unit) as never } },
      tooltip: { trigger: 'axis' },
      legend: { top: 0, right: 0 },
      series: [kind === 'line' ? { type: 'line', showSymbol: false } : { type: 'bar' }],
    },
  };
}

/**
 * A chart by category: bars, or a pie.
 *
 * @param ref - The query refId.
 * @param kind - Bars or a pie.
 * @returns The view.
 */
export function categoryChart(ref: string, kind: 'bar' | 'pie'): View {
  const option =
    kind === 'pie'
      ? { tooltip: { trigger: 'item' }, legend: { top: 0, right: 0 }, series: [{ type: 'pie' }] }
      : {
          xAxis: { type: 'category' },
          yAxis: { type: 'value' },
          tooltip: { trigger: 'axis' },
          series: [{ type: 'bar' }],
        };
  return { kind: 'chart', prepare: 'cartesian', roles: {}, datasets: [{ ref }], option };
}

/**
 * A stat: one number reduced from a result.
 *
 * @param unit - How it reads.
 * @param reduce - How the series becomes one number.
 * @param field - The field, when not the first number.
 * @returns The view.
 */
export function statView(unit: Unit, reduce: StatReduce, field?: string): View {
  return {
    kind: 'stat',
    ref: 'A',
    reduce,
    format: formatterOf(unit),
    ...(field === undefined ? {} : { field }),
  };
}

/**
 * A table with the given columns.
 *
 * @param columns - The fields to show, the value last, formatted by the unit.
 * @param valueUnit - The unit of the value column, if there is one.
 * @returns The view.
 */
export function tableView(columns: readonly string[], valueUnit?: Unit): View {
  const last = columns.length - 1;
  return {
    kind: 'table',
    ref: 'A',
    columns: columns.map((field, index) =>
      index === last && valueUnit !== undefined
        ? { field, format: formatterOf(valueUnit), align: 'right' as const }
        : { field },
    ),
  };
}

/** How a custom or saved panel shows its result. */
export type ShowKind = 'line' | 'bar' | 'category-bar' | 'pie' | 'stat' | 'table';

/**
 * The view of a panel that names how it shows.
 *
 * @param show - Lines or bars over time, bars or a pie by category, one number, or a table.
 * @param unit - How the values read.
 * @param refs - The refIds of its queries.
 * @param columns - A table's columns.
 * @param reduce - How a stat reduces its result.
 * @returns The view, or `undefined` for a table without columns.
 */
export function viewOfKind(
  show: ShowKind,
  unit: Unit,
  refs: readonly string[],
  columns: readonly string[] | undefined,
  reduce: StatReduce,
): View | undefined {
  if (show === 'stat') return statView(unit, reduce);
  if (show === 'table') return columns?.length ? tableView(columns) : undefined;
  if (show === 'line' || show === 'bar') return timeChart(refs, show, unit);
  return categoryChart('A', show === 'pie' ? 'pie' : 'bar');
}

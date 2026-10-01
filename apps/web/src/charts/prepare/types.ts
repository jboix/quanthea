/** What a preparation takes and gives. */
import type { Dataset, FormatOptions, RoleColumns } from '@quanthea/shared';
import type { Loose } from '../loose.ts';

/** What a preparation takes. */
export interface PrepareInput {
  /** The option, series still templates. */
  readonly option: Loose;
  /** The view's datasets, the first being the main one. */
  readonly datasets: readonly Dataset[];
  /** The columns of each role. */
  readonly roles: RoleColumns;
  /** How many categories to keep, when the view says. */
  readonly limit: number | undefined;
  /** The time zone, for labels the preparation writes. */
  readonly format: FormatOptions;
}

/** What a preparation gives. */
export interface Prepared {
  /** The ECharts datasets. */
  readonly datasets: readonly Dataset[];
  /** The option, with any data the preparation put in it. */
  readonly option: Loose;
  /** The columns of each role, in the prepared datasets. */
  readonly roles: RoleColumns;
  /** When each dataset draws its own series, their names. */
  readonly groups?: readonly string[];
  /** Whether the series are final and need no expanding. */
  readonly expanded?: boolean;
  /** The grids, when the preparation lays out several, as small multiples do. */
  readonly grid?: readonly Loose[];
}

/**
 * The first series template of an option.
 *
 * @param option - The option.
 * @returns The template, or an empty object.
 */
export function firstSeries(option: Loose): Loose {
  const series = option.series;
  const first = Array.isArray(series) ? series[0] : series;
  return typeof first === 'object' && first !== null ? (first as Loose) : {};
}

/**
 * The option with its first series changed.
 *
 * @param option - The option.
 * @param change - What to merge into the first series.
 * @returns The option.
 */
export function withFirstSeries(option: Loose, change: Loose): Loose {
  const list = Array.isArray(option.series) ? option.series : [option.series ?? {}];
  const [first, ...rest] = list as Loose[];
  return { ...option, series: [{ ...first, ...change }, ...rest] };
}

/**
 * The option with a visual map's range set from values, unless the option sets it.
 *
 * @param option - The option.
 * @param values - The values the colours cover.
 * @returns The option.
 */
export function withVisualRange(option: Loose, values: readonly unknown[]): Loose {
  const visualMap = option.visualMap as Loose | undefined;
  if (!visualMap || (visualMap.min !== undefined && visualMap.max !== undefined)) return option;
  const numbers = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  const [min, max] = numbers.length === 0 ? [0, 1] : [Math.min(...numbers), Math.max(...numbers)];
  return { ...option, visualMap: { min, max: max === min ? min + 1 : max, ...visualMap } };
}

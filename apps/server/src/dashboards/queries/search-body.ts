/**
 * The parts of a search body the search builders share: the time range, the measure as a metric
 * aggregation, and the ratio aggregations. The filters are written in `search-filters.ts`.
 */
import { refusedAnywhere, searchRatioScripts } from '../../query/search-binder.ts';
import { boolQuery, type SearchFilter } from './search-filters.ts';
import type { SearchGroup, SearchMeasure } from './search-request.ts';
import { QueryError, variableOf } from './text.ts';

/** A JSON object of a search body. */
type Json = Record<string, unknown>;

/**
 * The time range on a field, bound to the dashboard's range.
 *
 * @param time - The time field.
 * @returns The range clause.
 */
export function inRange(time: string): Json {
  return { range: { [time]: { gte: { $var: '__from' }, lte: { $var: '__to' } } } };
}

/**
 * A bucket width: a duration as written, an interval variable as a node, or the built-in width.
 *
 * @param interval - Such as `5m` or `$interval`, or nothing.
 * @returns The `fixed_interval` value.
 */
export function intervalOf(interval: string | undefined): unknown {
  if (interval === undefined) return { $var: '__interval' };
  const variable = variableOf(interval);
  return variable === undefined ? interval : { $var: variable };
}

/**
 * The metric aggregation of a measure. A count counts the time field's values: every document.
 *
 * @param measure - The measure.
 * @param time - The time field.
 * @returns The aggregation.
 * @throws {QueryError} When a measure other than count names no field.
 */
export function metricOf(measure: SearchMeasure, time: string): Json {
  if (measure.fn === 'count') return { value_count: { field: measure.field ?? time } };
  if (!measure.field) throw new QueryError(`${measure.fn} needs a field.`);
  if (measure.fn === 'percentiles')
    return { percentiles: { field: measure.field, percents: measure.percents ?? [50, 95, 99] } };
  return { [measure.fn]: { field: measure.field } };
}

/**
 * The columns a measure gives under the name `value`.
 *
 * @param measure - The measure.
 * @returns `value`, or `value p95` and the like for percentiles.
 */
export function valueColumns(measure: SearchMeasure): string[] {
  if (measure.fn !== 'percentiles') return ['value'];
  return (measure.percents ?? [50, 95, 99]).map((percent) => `value p${percent}`);
}

/** What a ratio counts and how it shows. */
export interface RatioParts {
  /** The filters of the part. */
  readonly match: readonly SearchFilter[];
  /** The filters of the whole; every document of the bucket when empty. */
  readonly of: readonly SearchFilter[];
  /** Whether it is one minus the share. */
  readonly complement: boolean;
  /** Whether the counts of the part and the whole are columns. */
  readonly counts: boolean;
}

/**
 * The kit's ratio script: the share, or one minus it. Both are zero when the whole is zero.
 *
 * @param complement - Whether it is one minus the share.
 * @returns The script.
 */
export function ratioScriptOf(complement: boolean): string {
  return complement ? searchRatioScripts.complement : searchRatioScripts.ratio;
}

/**
 * The aggregations of a ratio under a bucket: the part and the whole as filters, and the share as
 * a `bucket_script` with the kit's ratio script. The counts are helpers unless asked for.
 *
 * @param parts - What the ratio counts.
 * @returns The aggregations, the part named first.
 */
export function ratioAggs(parts: RatioParts): Json {
  const part = parts.counts ? 'matching' : '_matching';
  const whole = parts.counts ? 'total' : '_total';
  const wholeFilter = parts.of.length > 0 || parts.counts;
  const script = ratioScriptOf(parts.complement);
  return {
    [part]: { filter: boolQuery(parts.match) },
    ...(wholeFilter ? { [whole]: { filter: boolQuery(parts.of) } } : {}),
    value: {
      bucket_script: {
        buckets_path: { part: `${part}>_count`, whole: wholeFilter ? `${whole}>_count` : '_count' },
        script,
      },
    },
  };
}

/** The column named groups fill with their names. */
export const groupColumn = 'group';

/**
 * The fields or named groups a builder splits by: one of the two, not both. `other` counts the
 * documents a grouping by values left out, so it goes with a field.
 *
 * @param by - The field or fields, if any.
 * @param groups - The named groups, if any.
 * @param other - Whether an "Other" row is asked for.
 * @throws {QueryError} When both or neither are given, or `other` comes with groups.
 */
export function checkSplit(by: unknown, groups: unknown, other: boolean): void {
  if ((by === undefined) === (groups === undefined))
    throw new QueryError('Split by "by" or by named "groups": one of the two.');
  if (groups !== undefined && other)
    throw new QueryError('"other" goes with "by": named groups hold only what they name.');
}

/**
 * The `filters` aggregation of named groups: one bucket per group, keyed by its name.
 *
 * @param groups - The groups.
 * @returns The aggregation, without its sub-aggregations.
 * @throws {QueryError} For two groups of one name, or a name the search check refuses.
 */
export function namedGroupsOf(groups: readonly SearchGroup[]): Json {
  const names = new Set<string>();
  for (const { name } of groups) {
    if (names.has(name)) throw new QueryError(`Two groups are named "${name}".`);
    if (refusedAnywhere(name)) throw new QueryError(`"${name}" cannot name a group.`);
    names.add(name);
  }
  const filters = Object.fromEntries(groups.map((group) => [group.name, boolQuery(group.filters)]));
  return { filters: { filters } };
}

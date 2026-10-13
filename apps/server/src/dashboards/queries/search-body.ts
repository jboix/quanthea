/**
 * The parts of a search body the search builders share: the time range, the measure as a metric
 * aggregation, and the ratio aggregations. The filters are written in `search-filters.ts`.
 */
import { searchRatioScripts } from '../../query/search-binder.ts';
import { boolQuery, type SearchFilter } from './search-filters.ts';
import type { SearchMeasure } from './search-request.ts';
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
  const script = parts.complement ? searchRatioScripts.complement : searchRatioScripts.ratio;
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

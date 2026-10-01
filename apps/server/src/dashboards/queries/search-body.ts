/**
 * The parts of a search body the search builders share: filters as a bool query, the time range,
 * the measure as a metric aggregation, and the ratio aggregations. A variable becomes a
 * `{"$var": "name"}` node, never text in a string; `=` takes a list, so a multi-value variable
 * works too.
 */
import { searchRatioScripts } from '../../query/search-binder.ts';
import type { PathFilter } from './fields.ts';
import type { SearchMeasure } from './search-request.ts';
import { QueryError, variableOf } from './text.ts';

/** A JSON object of a search body. */
type Json = Record<string, unknown>;

/**
 * A filter's value: a variable node, as a list for `=` and `!=`, or the literal.
 *
 * @param value - Such as `ERROR` or `$platform`.
 * @param list - Whether a variable becomes a list.
 * @returns The JSON value.
 */
function filterValue(value: string, list: boolean): unknown {
  const variable = variableOf(value);
  if (variable === undefined) return value;
  return list ? { $var: variable, as: 'list' } : { $var: variable };
}

/**
 * The query clause of one filter, positive: `term` or `terms` for equality, `regexp` for a pattern.
 *
 * @param filter - The filter.
 * @returns The clause.
 */
function clauseOf(filter: PathFilter): Json {
  const pattern = filter.op === '=~' || filter.op === '!~';
  if (pattern) return { regexp: { [filter.field]: filterValue(filter.value, false) } };
  if (variableOf(filter.value))
    return { terms: { [filter.field]: filterValue(filter.value, true) } };
  return { term: { [filter.field]: filter.value } };
}

/**
 * Filters as a bool query: the positive ones in `filter`, the negated ones in `must_not`.
 *
 * @param filters - The filters.
 * @param extra - Clauses that must also hold, such as the time range.
 * @returns The query.
 */
export function boolQuery(filters: readonly PathFilter[], extra: readonly Json[] = []): Json {
  const negated = (filter: PathFilter) => filter.op === '!=' || filter.op === '!~';
  const must = [...extra, ...filters.filter((filter) => !negated(filter)).map(clauseOf)];
  const mustNot = filters.filter(negated).map(clauseOf);
  const bool = mustNot.length === 0 ? { filter: must } : { filter: must, must_not: mustNot };
  return must.length === 0 && mustNot.length === 0 ? { match_all: {} } : { bool };
}

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
  readonly match: readonly PathFilter[];
  /** The filters of the whole; every document of the bucket when empty. */
  readonly of: readonly PathFilter[];
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

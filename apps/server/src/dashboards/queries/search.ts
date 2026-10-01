/**
 * The search builders, for Elasticsearch and OpenSearch: a measure over time, a ratio such as an
 * error rate, a breakdown by a field, one number, a histogram of a numeric field, and the latest
 * documents. Every search keeps to the time range; variables are nodes the binder fills.
 */
import type { PanelQuery } from '@quanthea/shared';
import type { BuiltData } from './built.ts';
import type { PathFilter } from './fields.ts';
import type { DataOf } from './request.ts';
import {
  boolQuery,
  inRange,
  intervalOf,
  metricOf,
  ratioAggs,
  valueColumns,
} from './search-body.ts';
import type { SearchMeasure } from './search-request.ts';

/** A JSON object of a search body. */
type Json = Record<string, unknown>;

/** What every search request has. */
interface SearchRequest {
  /** The connector. */
  readonly connector: string;
  /** The index or pattern. */
  readonly index: string;
  /** The time field. */
  readonly time: string;
  /** The filters. */
  readonly filters: readonly PathFilter[];
}

/**
 * A search query, refId A.
 *
 * @param request - The request, for its connector and index.
 * @param body - The body.
 * @returns The query.
 */
function searchQuery(request: SearchRequest, body: Json): PanelQuery {
  return {
    refId: 'A',
    connector: request.connector,
    language: 'search',
    index: request.index,
    body,
  };
}

/**
 * A body of aggregations only, over the filters and the time range.
 *
 * @param request - The request.
 * @param aggs - The aggregations.
 * @returns The body.
 */
function aggsBody(request: SearchRequest, aggs: Json): Json {
  return { size: 0, query: boolQuery(request.filters, [inRange(request.time)]), aggs };
}

/**
 * A terms aggregation, ordered by the measure when it is one number, else by document count.
 *
 * @param field - The field.
 * @param size - How many values.
 * @param measure - The measure under it, if any.
 * @returns The aggregation, without its sub-aggregations.
 */
function terms(field: string, size: number, measure?: SearchMeasure): Json {
  const byValue = measure !== undefined && measure.fn !== 'count' && measure.fn !== 'percentiles';
  return { field, size, order: byValue ? { value: 'desc' } : { _count: 'desc' } };
}

/**
 * The date histogram of a request.
 *
 * @param request - The request.
 * @param interval - The bucket width, if given.
 * @param minDocCount - The fewest documents a bucket shows with.
 * @returns The aggregation, without its sub-aggregations.
 */
function histogramOf(request: SearchRequest, interval: string | undefined, minDocCount = 0): Json {
  return { field: request.time, fixed_interval: intervalOf(interval), min_doc_count: minDocCount };
}

/**
 * A measure over time: columns `time`, `series` when split, and the measure's.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function searchSeriesData(request: DataOf<'search-series'>): BuiltData {
  const metric = { value: metricOf(request.measure, request.time) };
  const level = request.by
    ? { series: { terms: terms(request.by, request.limit, request.measure), aggs: metric } }
    : metric;
  const aggs = { time: { date_histogram: histogramOf(request, request.interval), aggs: level } };
  const columns = ['time', ...(request.by ? ['series'] : []), ...valueColumns(request.measure)];
  return {
    queries: [searchQuery(request, aggsBody(request, aggs))],
    output: { shape: 'long', columns, chart: 'trend.line' },
  };
}

/**
 * The bucket aggregation a ratio sits under: the split, or one bucket over the whole range.
 *
 * @param request - The request.
 * @param ratio - The ratio's aggregations.
 * @returns The aggregations.
 */
function ratioLevel(request: DataOf<'search-ratio'>, ratio: Json): Json {
  if (request.by === undefined)
    return { _all: { filters: { filters: { all: { match_all: {} } } }, aggs: ratio } };
  const order = { [request.counts ? 'matching' : '_matching']: 'desc' };
  const name = request.over === 'time' ? 'series' : request.by;
  return { [name]: { terms: { field: request.by, size: request.limit, order }, aggs: ratio } };
}

/**
 * A ratio over time: columns `time`, `series` when split, the counts when asked, and `value`.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
function ratioOverTime(request: DataOf<'search-ratio'>): BuiltData {
  const ratio = ratioAggs(request);
  const level = request.by === undefined ? ratio : ratioLevel(request, ratio);
  const aggs = { time: { date_histogram: histogramOf(request, request.interval, 1), aggs: level } };
  const counts = request.counts ? ['matching', 'total'] : [];
  const columns = ['time', ...(request.by ? ['series'] : []), ...counts, 'value'];
  return {
    queries: [searchQuery(request, aggsBody(request, aggs))],
    output: { shape: 'long', columns, chart: 'trend.line', unit: 'percent' },
  };
}

/**
 * The share of the documents matching `match` among those matching `of`: over time, columns
 * `time`, `series` when split and `value`; over the range, the `by` field and `value`, or `value`
 * alone. With `counts`, `matching` and `total` come before `value`.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function searchRatioData(request: DataOf<'search-ratio'>): BuiltData {
  if (request.over === 'time') return ratioOverTime(request);
  const counts = request.counts ? ['matching', 'total'] : [];
  const ratio = ratioAggs(request);
  const by = request.by === undefined ? [] : [request.by];
  return {
    queries: [searchQuery(request, aggsBody(request, ratioLevel(request, ratio)))],
    output: {
      shape: request.by ? 'long' : 'single',
      columns: [...by, ...counts, 'value'],
      chart: request.by ? 'comparison.bar' : 'kpi.stat',
      unit: 'percent',
    },
  };
}

/**
 * A measure by the values of a field, largest first: columns the `by` field, `series` when split
 * again, and the measure's.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function searchBreakdownData(request: DataOf<'search-breakdown'>): BuiltData {
  const metric = { value: metricOf(request.measure, request.time) };
  const inner = request.series
    ? { series: { terms: terms(request.series, request.limit, request.measure), aggs: metric } }
    : metric;
  const aggs = {
    [request.by]: { terms: terms(request.by, request.limit, request.measure), aggs: inner },
  };
  const columns = [
    request.by,
    ...(request.series ? ['series'] : []),
    ...valueColumns(request.measure),
  ];
  return {
    queries: [searchQuery(request, aggsBody(request, aggs))],
    output: { shape: 'long', columns, chart: 'comparison.bar' },
  };
}

/**
 * One number over the range: the measure's column.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function searchStatData(request: DataOf<'search-stat'>): BuiltData {
  const aggs = { value: metricOf(request.measure, request.time) };
  return {
    queries: [searchQuery(request, aggsBody(request, aggs))],
    output: { shape: 'single', columns: valueColumns(request.measure), chart: 'kpi.stat' },
  };
}

/**
 * The documents in each bin of a numeric field: columns `bin` and `value`.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function searchHistogramData(request: DataOf<'search-histogram'>): BuiltData {
  const histogram = { field: request.field, interval: request.width, min_doc_count: 1 };
  const aggs = {
    bin: { histogram, aggs: { value: metricOf({ fn: 'count' }, request.time) } },
  };
  return {
    queries: [searchQuery(request, aggsBody(request, aggs))],
    output: { shape: 'long', columns: ['bin', 'value'], chart: 'comparison.bar' },
  };
}

/**
 * The latest documents, newest first: the fields asked for.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function searchRowsData(request: DataOf<'search-rows'>): BuiltData {
  const body = {
    size: request.limit,
    query: boolQuery(request.filters, [inRange(request.time)]),
    sort: [{ [request.time]: 'desc' }],
    _source: request.fields,
  };
  return {
    queries: [searchQuery(request, body)],
    output: { shape: 'rows', columns: request.fields, chart: 'table.rows' },
  };
}

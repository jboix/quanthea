/**
 * The MongoDB builders, as aggregation pipelines: a measure over time, a ratio such as a failure
 * rate, a breakdown by a field, one number, a histogram of a numeric field, and the latest
 * documents. Each ends with a `$project` that names the columns, so the table is known.
 */
import type { PanelQuery } from '@quanthea/shared';
import type { BuiltData } from './built.ts';
import type { PathFilter } from './fields.ts';
import {
  accumulatorOf,
  bucketOf,
  conditionOf,
  matchStage,
  valueProjection,
} from './mongodb-pipeline.ts';
import type { DataOf } from './request.ts';
import { QueryError } from './text.ts';

/** A JSON object of a pipeline. */
type Json = Record<string, unknown>;

/** What every MongoDB request has. */
interface MongodbRequest {
  /** The connector. */
  readonly connector: string;
  /** The collection. */
  readonly collection: string;
  /** The time field, if any. */
  readonly time?: string | undefined;
  /** The filters. */
  readonly filters: readonly PathFilter[];
}

/**
 * A MongoDB query, refId A: the request's `$match`, then the stages.
 *
 * @param request - The request.
 * @param stages - The stages after the match.
 * @returns The query.
 */
function mongodbQuery(request: MongodbRequest, stages: Json[]): PanelQuery {
  const pipeline = [matchStage(request.time, request.filters), ...stages];
  return {
    refId: 'A',
    connector: request.connector,
    language: 'mongodb',
    collection: request.collection,
    pipeline,
  };
}

/**
 * A measure over time: columns `time`, `series` when split, and the measure's.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function mongodbSeriesData(request: DataOf<'mongodb-series'>): BuiltData {
  const by = request.by ? { series: `$${request.by}` } : {};
  const values = valueProjection(request.measure);
  const stages = [
    {
      $group: {
        _id: { time: bucketOf(request.time, request.interval), ...by },
        value: accumulatorOf(request.measure),
      },
    },
    {
      $project: {
        _id: 0,
        time: '$_id.time',
        ...(request.by ? { series: '$_id.series' } : {}),
        ...values,
      },
    },
    { $sort: { time: 1 } },
  ];
  const columns = ['time', ...(request.by ? ['series'] : []), ...Object.keys(values)];
  return {
    queries: [mongodbQuery(request, stages)],
    output: { shape: 'long', columns, chart: 'trend.line' },
  };
}

/**
 * The share of the documents matching `match` among those matching `of`, as `value`, and the two
 * counts as `matching` and `total` when asked.
 *
 * @param request - The request.
 * @returns The `$project` fields.
 */
function ratioProjection(request: DataOf<'mongodb-ratio'>): Json {
  const share = {
    $cond: [{ $gt: ['$_total', 0] }, { $divide: ['$_matching', '$_total'] }, 0],
  };
  const counts = request.counts ? { matching: '$_matching', total: '$_total' } : {};
  return { ...counts, value: request.complement ? { $subtract: [1, share] } : share };
}

/**
 * The `$group` of a ratio: the counts of the part and the whole, under a key.
 *
 * @param request - The request.
 * @param key - The group key.
 * @returns The stage.
 */
function ratioGroup(request: DataOf<'mongodb-ratio'>, key: unknown): Json {
  const count = (filters: readonly PathFilter[]) => ({
    $sum: { $cond: [conditionOf(filters), 1, 0] },
  });
  return { $group: { _id: key, _matching: count(request.match), _total: count(request.of) } };
}

/**
 * A ratio over time: columns `time`, `series` when split, the counts when asked, and `value`.
 *
 * @param request - The request.
 * @param time - The time field.
 * @returns The query and its output.
 */
function ratioOverTime(request: DataOf<'mongodb-ratio'>, time: string): BuiltData {
  const by = request.by ? { series: `$${request.by}` } : {};
  const projection = ratioProjection(request);
  const stages = [
    ratioGroup(request, { time: bucketOf(time, request.interval), ...by }),
    {
      $project: {
        _id: 0,
        time: '$_id.time',
        ...(request.by ? { series: '$_id.series' } : {}),
        ...projection,
      },
    },
    { $sort: { time: 1 } },
  ];
  const columns = ['time', ...(request.by ? ['series'] : []), ...Object.keys(projection)];
  return {
    queries: [mongodbQuery(request, stages)],
    output: { shape: 'long', columns, chart: 'trend.line', unit: 'percent' },
  };
}

/**
 * The share of the documents matching `match` among those matching `of`: over time; over the
 * range, per value of `by`, the most matching first, or one value.
 *
 * @param request - The request.
 * @returns The query and its output.
 * @throws {QueryError} For a ratio over time without a time field.
 */
export function mongodbRatioData(request: DataOf<'mongodb-ratio'>): BuiltData {
  if (request.over === 'range') return ratioOverRange(request);
  if (!request.time) throw new QueryError('A ratio over time needs a time field.');
  return ratioOverTime(request, request.time);
}

/**
 * A ratio over the range: per value of `by`, the most matching first, or one value.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
function ratioOverRange(request: DataOf<'mongodb-ratio'>): BuiltData {
  const projection = ratioProjection(request);
  const by = request.by;
  const stages = [
    ratioGroup(request, by ? `$${by}` : null),
    ...(by ? [{ $sort: { _matching: -1 } }, { $limit: request.limit }] : []),
    { $project: { _id: 0, ...(by ? { [by]: '$_id' } : {}), ...projection } },
  ];
  return {
    queries: [mongodbQuery(request, stages)],
    output: {
      shape: by ? 'long' : 'single',
      columns: [...(by ? [by] : []), ...Object.keys(projection)],
      chart: by ? 'comparison.bar' : 'kpi.stat',
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
export function mongodbBreakdownData(request: DataOf<'mongodb-breakdown'>): BuiltData {
  const series = request.series ? { series: `$${request.series}` } : {};
  const values = valueProjection(request.measure);
  const [first = 'value'] = Object.keys(values);
  const stages = [
    {
      $group: { _id: { by: `$${request.by}`, ...series }, value: accumulatorOf(request.measure) },
    },
    {
      $project: {
        _id: 0,
        [request.by]: '$_id.by',
        ...(request.series ? { series: '$_id.series' } : {}),
        ...values,
      },
    },
    { $sort: { [first]: -1 } },
    { $limit: request.limit },
  ];
  const columns = [request.by, ...(request.series ? ['series'] : []), ...Object.keys(values)];
  return {
    queries: [mongodbQuery(request, stages)],
    output: { shape: 'long', columns, chart: 'comparison.bar' },
  };
}

/**
 * One number over the range: the measure's column.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function mongodbStatData(request: DataOf<'mongodb-stat'>): BuiltData {
  const values = valueProjection(request.measure);
  const stages = [
    { $group: { _id: null, value: accumulatorOf(request.measure) } },
    { $project: { _id: 0, ...values } },
  ];
  return {
    queries: [mongodbQuery(request, stages)],
    output: { shape: 'single', columns: Object.keys(values), chart: 'kpi.stat' },
  };
}

/**
 * The documents in each bin of a numeric field: columns `bin` and `value`.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function mongodbHistogramData(request: DataOf<'mongodb-histogram'>): BuiltData {
  const field = `$${request.field}`;
  const bin = { $multiply: [{ $floor: { $divide: [field, request.width] } }, request.width] };
  const stages = [
    { $match: { [request.field]: { $type: 'number' } } },
    { $group: { _id: bin, value: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, bin: '$_id', value: 1 } },
  ];
  return {
    queries: [mongodbQuery(request, stages)],
    output: { shape: 'long', columns: ['bin', 'value'], chart: 'comparison.bar' },
  };
}

/**
 * The latest documents, newest first when there is a time field: the fields asked for.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function mongodbRowsData(request: DataOf<'mongodb-rows'>): BuiltData {
  const fields = Object.fromEntries(request.fields.map((field) => [field, 1]));
  const stages = [
    ...(request.time ? [{ $sort: { [request.time]: -1 } }] : []),
    { $limit: request.limit },
    { $project: { _id: request.fields.includes('_id') ? 1 : 0, ...fields } },
  ];
  return {
    queries: [mongodbQuery(request, stages)],
    output: { shape: 'rows', columns: request.fields, chart: 'table.rows' },
  };
}

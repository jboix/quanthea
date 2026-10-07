/**
 * The stages and expressions the MongoDB builders share: filters as a `$match` and as a condition,
 * the time range, the measure as an accumulator and its output columns. A variable becomes a
 * `{"$var": "name"}` node. A literal that reads as a number or a boolean also matches as one, since
 * MongoDB compares types strictly. In an aggregation expression, a value is wrapped in `$literal`.
 */
import type { PathFilter } from './fields.ts';
import type { MongodbMeasure } from './mongodb-request.ts';
import { QueryError, variableOf } from './text.ts';

/** A JSON object of a pipeline. */
type Json = Record<string, unknown>;

/**
 * The values a filter's value stands for: a variable as a list node, or a literal with the number
 * or boolean it reads as.
 *
 * @param value - Such as `500`, `failed` or `$status`.
 * @returns A list node, or the literal values.
 */
function valuesOf(value: string): unknown {
  const variable = variableOf(value);
  if (variable !== undefined) return { $var: variable, as: 'list' };
  const typed: unknown[] = [value];
  if (value.trim() !== '' && Number.isFinite(Number(value))) typed.push(Number(value));
  if (value === 'true' || value === 'false') typed.push(value === 'true');
  return typed;
}

/**
 * A pattern: a variable node, or the literal.
 *
 * @param value - The pattern.
 * @returns The JSON value.
 */
function patternOf(value: string): unknown {
  const variable = variableOf(value);
  return variable === undefined ? value : { $var: variable };
}

/**
 * One filter in query syntax, for `$match`.
 *
 * @param filter - The filter.
 * @returns Such as `{"status": {"$in": ["failed"]}}`.
 */
function queryOf(filter: PathFilter): Json {
  const condition = {
    '=': { $in: valuesOf(filter.value) },
    '!=': { $nin: valuesOf(filter.value) },
    '=~': { $regex: patternOf(filter.value) },
    '!~': { $not: { $regex: patternOf(filter.value) } },
  }[filter.op];
  return { [filter.field]: condition };
}

/**
 * The `$match` stage of a request: the time range when there is a time field, and the filters.
 *
 * @param time - The time field, if any.
 * @param filters - The filters.
 * @returns The stage.
 */
export function matchStage(time: string | undefined, filters: readonly PathFilter[]): Json {
  const range = time ? [{ [time]: { $gte: { $var: '__from' }, $lt: { $var: '__to' } } }] : [];
  const clauses = [...range, ...filters.map(queryOf)];
  return { $match: clauses.length === 0 ? {} : { $and: clauses } };
}

/**
 * One filter as an aggregation expression, for a ratio's conditions. Values go in `$literal`, so a
 * value such as `$secret` or `$$ROOT` stays a string and is never read as a field path.
 *
 * @param filter - The filter.
 * @returns Such as `{"$in": ["$level", {"$literal": ["error"]}]}`.
 */
function expressionOf(filter: PathFilter): Json {
  const field = `$${filter.field}`;
  if (filter.op === '=' || filter.op === '!=') {
    const test = { $in: [field, { $literal: valuesOf(filter.value) }] };
    return filter.op === '=' ? test : { $not: [test] };
  }
  const text = { $convert: { input: field, to: 'string', onError: '', onNull: '' } };
  const test = { $regexMatch: { input: text, regex: { $literal: patternOf(filter.value) } } };
  return filter.op === '=~' ? test : { $not: [test] };
}

/**
 * Filters as one condition, true when every one holds; true when there is none.
 *
 * @param filters - The filters.
 * @returns The expression.
 */
export function conditionOf(filters: readonly PathFilter[]): unknown {
  return filters.length === 0 ? true : { $and: filters.map(expressionOf) };
}

/**
 * The accumulator of a measure, for `$group`.
 *
 * @param measure - The measure.
 * @returns Such as `{"$sum": 1}` or `{"$avg": "$total"}`.
 * @throws {QueryError} When a measure other than count names no field.
 */
export function accumulatorOf(measure: MongodbMeasure): Json {
  if (measure.fn === 'count') return { $sum: 1 };
  if (!measure.field) throw new QueryError(`${measure.fn} needs a field.`);
  const field = `$${measure.field}`;
  if (measure.fn === 'count_distinct') return { $addToSet: field };
  if (measure.fn !== 'percentiles') return { [`$${measure.fn}`]: field };
  const p = percentsOf(measure).map((percent) => percent / 100);
  return { $percentile: { input: field, p, method: 'approximate' } };
}

/**
 * The percents of a percentiles measure.
 *
 * @param measure - The measure.
 * @returns The percents, 50, 95 and 99 by default.
 */
function percentsOf(measure: MongodbMeasure): number[] {
  return measure.percents ?? [50, 95, 99];
}

/**
 * The output columns of a measure grouped as `value`, for `$project`.
 *
 * @param measure - The measure.
 * @returns Such as `{"value": "$value"}`, or `value p95` and the like for percentiles.
 */
export function valueProjection(measure: MongodbMeasure): Json {
  if (measure.fn === 'count_distinct') return { value: { $size: '$value' } };
  if (measure.fn !== 'percentiles') return { value: '$value' };
  return Object.fromEntries(
    percentsOf(measure).map((percent, index) => [
      `value p${percent}`,
      { $arrayElemAt: ['$value', index] },
    ]),
  );
}

/**
 * A time bucket: the time field truncated to the interval, in milliseconds.
 *
 * @param time - The time field.
 * @param interval - Such as `5m` or `$interval`, or nothing for the built-in width.
 * @returns The `$dateTrunc` expression.
 */
export function bucketOf(time: string, interval: string | undefined): Json {
  return { $dateTrunc: { date: `$${time}`, unit: 'millisecond', binSize: binSizeOf(interval) } };
}

/**
 * A bucket width in milliseconds: a literal duration converted, a variable or the built-in width
 * as a node the binder converts.
 *
 * @param interval - Such as `5m` or `$interval`, or nothing.
 * @returns Milliseconds, or the node.
 */
function binSizeOf(interval: string | undefined): unknown {
  if (interval === undefined) return { $var: '__interval_ms', as: 'ms' };
  const variable = variableOf(interval);
  return variable === undefined ? millisecondsOf(interval) : { $var: variable, as: 'ms' };
}

/**
 * A literal duration in milliseconds.
 *
 * @param duration - Such as `5m`.
 * @returns Milliseconds.
 */
function millisecondsOf(duration: string): number {
  const units: Readonly<Record<string, number>> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return Number(duration.slice(0, -1)) * (units[duration.slice(-1)] ?? 0);
}

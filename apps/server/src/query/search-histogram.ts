/**
 * Fills the date histograms of a search over the whole time range. A date histogram returns
 * buckets only between its first and its last document, so a chart of it is cut to the stretch
 * that has data, and a week reads like a day. A histogram over the field the time range filters
 * keeps its empty buckets and takes the range as its bounds, unless the query sets either itself.
 */
import type { TimeRange } from '../connectors/_shared/index.ts';
import { boundFormat, isoBound } from './search-dates.ts';

/** A JSON object of a search body. */
type Json = Readonly<Record<string, unknown>>;

/**
 * The most buckets a filled histogram has over the time range. The built-in interval gives at
 * most 1000 and a chosen one at most 1500; a histogram with a finer width of its own is left as
 * written, so filling never asks a server for more buckets than a chart is cut into.
 */
export const maxFilledBuckets = 1500;

/** A day, in milliseconds. */
const day = 86_400_000;

/** The width of each unit of a `fixed_interval`, in milliseconds. */
const fixedUnits: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: day,
};

/** The shortest width of each `calendar_interval`, in milliseconds. */
const calendarWidths: Readonly<Record<string, number>> = {
  minute: 60_000,
  '1m': 60_000,
  hour: 3_600_000,
  '1h': 3_600_000,
  day,
  '1d': day,
  week: 7 * day,
  '1w': 7 * day,
  month: 28 * day,
  '1M': 28 * day,
  quarter: 89 * day,
  '1q': 89 * day,
  year: 365 * day,
  '1y': 365 * day,
};

/** Aggregations with one bucket: a histogram under one is still the first level of buckets. */
const singleBucketTypes = [
  'filter',
  'global',
  'missing',
  'nested',
  'reverse_nested',
  'sampler',
  'diversified_sampler',
];

/** The keys the sub-aggregations of a level are under. */
const aggregationKeys = ['aggs', 'aggregations'] as const;

/** The built-ins a range names to follow the time range. */
const periodBuiltIns: ReadonlySet<unknown> = new Set(['__from', '__to']);

/**
 * Whether a value is a JSON object, not an array or null.
 *
 * @param value - The value.
 * @returns `true` for an object.
 */
function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether the bounds of a range name the time range: one of them is `__from` or `__to`.
 *
 * @param bounds - The bounds of one field, as the template writes them.
 * @returns `true` when the field is filtered by the time range.
 */
function followsPeriod(bounds: unknown): boolean {
  if (!isObject(bounds)) return false;
  return Object.values(bounds).some((bound) => isObject(bound) && periodBuiltIns.has(bound.$var));
}

/**
 * The fields a search template filters by the time range: those of a `range` bounded by `__from`
 * or `__to`.
 *
 * @param node - The template's body, before its variables are bound.
 * @param parent - The key the node is under.
 * @returns The names of the fields.
 */
export function periodFields(node: unknown, parent?: string): ReadonlySet<string> {
  if (Array.isArray(node)) return new Set(node.flatMap((item) => [...periodFields(item, parent)]));
  if (!isObject(node)) return new Set();
  const own = Object.entries(node)
    .filter(([, bounds]) => parent === 'range' && followsPeriod(bounds))
    .map(([field]) => field);
  const below = Object.entries(node).flatMap(([key, value]) => [...periodFields(value, key)]);
  return new Set([...own, ...below]);
}

/**
 * The width of a histogram's buckets.
 *
 * @param histogram - The date histogram, its variables bound.
 * @returns The width in milliseconds, the shortest a calendar interval has, or `undefined` when
 *   the histogram names none this reads.
 */
function widthOf(histogram: Json): number | undefined {
  const fixed = /^(\d+)(ms|s|m|h|d)$/.exec(String(histogram.fixed_interval ?? ''));
  if (fixed) return Number(fixed[1]) * (fixedUnits[fixed[2] ?? ''] ?? 0) || undefined;
  return calendarWidths[String(histogram.calendar_interval ?? '')];
}

/** What filling needs: the fields the time range filters, and the range. */
interface Fill {
  /** The fields a range of the query bounds with the time range. */
  readonly fields: ReadonlySet<string>;
  /** The time range. */
  readonly timeRange: TimeRange;
}

/**
 * Whether a histogram is the query's to keep as written: it sets its own bounds, or keeps only
 * buckets with documents.
 *
 * @param histogram - The date histogram.
 * @returns `true` when the query decided what the histogram covers.
 */
function setsItsOwn(histogram: Json): boolean {
  if ('extended_bounds' in histogram || 'hard_bounds' in histogram) return true;
  return histogram.min_doc_count !== undefined && histogram.min_doc_count !== 0;
}

/**
 * A date histogram filled over the time range: its empty buckets kept, its bounds the range. The
 * bounds are epoch milliseconds, which a server reads whatever the format of the field. The upper
 * one is the last millisecond before the end, so a range that ends on a bucket's edge gets no
 * empty bucket after it.
 *
 * @param histogram - The date histogram, its variables bound.
 * @param fill - The fields the time range filters, and the range.
 * @returns The histogram, filled when it is over such a field, sets neither `min_doc_count` above
 *   0 nor bounds, and has at most {@link maxFilledBuckets} buckets over the range.
 */
function filled(histogram: Json, fill: Fill): Json {
  if (setsItsOwn(histogram) || !fill.fields.has(String(histogram.field))) return histogram;
  const from = fill.timeRange.from.getTime();
  const to = fill.timeRange.to.getTime();
  const width = widthOf(histogram);
  if (width === undefined || (to - from) / width > maxFilledBuckets) return histogram;
  return { ...histogram, min_doc_count: 0, extended_bounds: { min: from, max: to - 1 } };
}

/**
 * One aggregation with the histogram of its first level of buckets filled: its own, or the one
 * under an aggregation with one bucket. A histogram under another bucket aggregation, such as a
 * terms, is left as written: filling it would multiply its buckets by the terms.
 *
 * @param aggregation - The aggregation's body.
 * @param fill - The fields the time range filters, and the range.
 * @returns The aggregation.
 */
function filledAggregation(aggregation: unknown, fill: Fill): unknown {
  if (!isObject(aggregation)) return aggregation;
  if (isObject(aggregation.date_histogram))
    return { ...aggregation, date_histogram: filled(aggregation.date_histogram, fill) };
  if (!singleBucketTypes.some((type) => type in aggregation)) return aggregation;
  return withFilledLevel(aggregation, fill);
}

/**
 * A level of a search with the histograms of its aggregations filled.
 *
 * @param level - The body, or an aggregation with one bucket.
 * @param fill - The fields the time range filters, and the range.
 * @returns The level.
 */
function withFilledLevel(level: Json, fill: Fill): Json {
  const key = aggregationKeys.find((each) => isObject(level[each]));
  if (key === undefined) return level;
  const aggregations = Object.entries(level[key] as Json).map(
    ([name, aggregation]) => [name, filledAggregation(aggregation, fill)] as const,
  );
  return { ...level, [key]: Object.fromEntries(aggregations) };
}

/**
 * A search body whose date histograms over the time range are filled over all of it.
 *
 * @param body - The body, its variables bound.
 * @param fields - The fields a range of the template bounds with the time range.
 * @param timeRange - The time range.
 * @returns The body. It is the same when no range follows the time range.
 */
export function withFilledHistograms(
  body: Json,
  fields: ReadonlySet<string>,
  timeRange: TimeRange,
): Json {
  return fields.size === 0 ? body : withFilledLevel(body, { fields, timeRange });
}

/**
 * A date histogram whose bounds say how they are written when one is ISO 8601 text, as `__from`
 * and `__to` are bound. A histogram reads its bounds in the format of its field, such as
 * `epoch_millis` alone, and refuses any other with a parse error; its own `format` says how they
 * read, whatever the field's.
 *
 * @param histogram - The value of a `date_histogram` key, its variables bound.
 * @returns The histogram, with the format when it names none and a bound is ISO text.
 */
export function withBoundsFormat(histogram: unknown): unknown {
  if (!isObject(histogram) || 'format' in histogram) return histogram;
  const bounds = [histogram.extended_bounds, histogram.hard_bounds].filter(isObject);
  const written = bounds.flatMap((each) => [each.min, each.max]);
  return written.some(isoBound) ? { ...histogram, format: boundFormat } : histogram;
}

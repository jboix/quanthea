/**
 * Fills the date histograms of a search over the whole time range. A date histogram returns
 * buckets only between its first and its last document, so a chart of it is cut to the stretch
 * that has data, and a week reads like a day. A histogram over the field the time range filters
 * keeps its empty buckets and takes the range as its bounds, on each side the query bounds with
 * it, unless the query sets either itself.
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

/** The keys of a range that hold its lower bound. */
const lowerKeys = ['gte', 'gt', 'from'] as const;

/** The keys of a range that hold its upper bound. */
const upperKeys = ['lte', 'lt', 'to'] as const;

/** The sides of the time range a query bounds a field with. */
export interface PeriodSides {
  /** Whether a lower bound of the field is `__from`. */
  readonly from: boolean;
  /** Whether an upper bound of the field is `__to`. */
  readonly to: boolean;
}

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
 * Whether a range bounds a side with a built-in.
 *
 * @param bounds - The bounds of one field, as the template writes them.
 * @param keys - The keys of the side.
 * @param builtIn - The built-in of the side.
 * @returns `true` when one of the keys holds the built-in.
 */
function names(bounds: Json, keys: readonly string[], builtIn: string): boolean {
  return keys.some((key) => {
    const bound = bounds[key];
    return isObject(bound) && bound.$var === builtIn;
  });
}

/**
 * The sides of the time range a range bounds its field with: the start as its lower bound, the
 * end as its upper bound. A built-in on the other side, as in `"lt": {"$var": "__from"}`, bounds
 * the field outside the time range, and counts for nothing.
 *
 * @param bounds - The bounds of one field, as the template writes them.
 * @returns The sides.
 */
function sidesOf(bounds: unknown): PeriodSides {
  if (!isObject(bounds)) return { from: false, to: false };
  return { from: names(bounds, lowerKeys, '__from'), to: names(bounds, upperKeys, '__to') };
}

/**
 * The ranges of a search template, each field with its bounds.
 *
 * @param node - A node of the template's body, before its variables are bound.
 * @param parent - The key the node is under.
 * @returns The field and the bounds of every `range`.
 */
function rangesOf(node: unknown, parent?: string): (readonly [string, unknown])[] {
  if (Array.isArray(node)) return node.flatMap((item) => rangesOf(item, parent));
  if (!isObject(node)) return [];
  const below = Object.entries(node).flatMap(([key, value]) => rangesOf(value, key));
  return parent === 'range' ? [...Object.entries(node), ...below] : below;
}

/**
 * The fields a search template bounds inside the time range, each with the sides it bounds: the
 * start as a lower bound, the end as an upper bound. Ranges over one field add up.
 *
 * @param body - The template's body, before its variables are bound.
 * @returns The sides by field. A field bounded on neither side is left out.
 */
export function periodFields(body: unknown): ReadonlyMap<string, PeriodSides> {
  const fields = new Map<string, PeriodSides>();
  for (const [field, bounds] of rangesOf(body)) {
    const sides = sidesOf(bounds);
    const known = fields.get(field);
    const from = sides.from || known?.from === true;
    const to = sides.to || known?.to === true;
    if (from || to) fields.set(field, { from, to });
  }
  return fields;
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
  /** The fields a range of the query bounds with the time range, and on which sides. */
  readonly fields: ReadonlyMap<string, PeriodSides>;
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
 * Whether a histogram of a width may be filled over a range: the range has a length, and the
 * width cuts it into at most {@link maxFilledBuckets} buckets.
 *
 * @param width - The width of a bucket in milliseconds, or `undefined` when unknown.
 * @param length - The length of the time range in milliseconds.
 * @returns `true` when filling asks for buckets a server gives.
 */
function fits(width: number | undefined, length: number): boolean {
  return width !== undefined && length > 0 && length / width <= maxFilledBuckets;
}

/**
 * A date histogram filled over the time range: its empty buckets kept, and its bounds the range on
 * each side the query bounds with it. Where the query bounds a side otherwise, or not at all, the
 * histogram ends at its documents there: an empty bucket past them would be a 0 the filter may
 * have made. The bounds are epoch milliseconds, which a server reads whatever the format of the
 * field. The upper one is the last millisecond before the end, so a range that ends on a bucket's
 * edge gets no empty bucket after it. A range that ends at or before its start is not filled: a
 * server refuses bounds that do not ascend.
 *
 * @param histogram - The date histogram, its variables bound.
 * @param fill - The fields the time range filters, and the range.
 * @returns The histogram, filled when it is over such a field, sets neither `min_doc_count` above
 *   0 nor bounds, and has at most {@link maxFilledBuckets} buckets over the range.
 */
function filled(histogram: Json, fill: Fill): Json {
  const sides = fill.fields.get(String(histogram.field));
  if (setsItsOwn(histogram) || sides === undefined) return histogram;
  const from = fill.timeRange.from.getTime();
  const to = fill.timeRange.to.getTime();
  if (!fits(widthOf(histogram), to - from)) return histogram;
  const bounds = { ...(sides.from ? { min: from } : {}), ...(sides.to ? { max: to - 1 } : {}) };
  return { ...histogram, min_doc_count: 0, extended_bounds: bounds };
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
 * @param fields - The fields a range of the template bounds with the time range, and the sides.
 * @param timeRange - The time range.
 * @returns The body. It is the same when no range follows the time range.
 */
export function withFilledHistograms(
  body: Json,
  fields: ReadonlyMap<string, PeriodSides>,
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

/**
 * How many buckets a bound search asks for over a time range: the time buckets of each date
 * histogram times the groups of every grouping under or above it. A search server answers a
 * request over its bucket limit with an error, so a dashboard is refused that limit when it is
 * written, with an interval that fits, not when a viewer opens it.
 */

/** A JSON object of a search body. */
type Json = Readonly<Record<string, unknown>>;

/** The most buckets one search may make: Elasticsearch's and OpenSearch's default limit. */
export const maxSearchBuckets = 65_536;

/** Milliseconds in each unit a search interval may use. */
const unitMs: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  M: 2_592_000_000,
  q: 7_776_000_000,
  y: 31_536_000_000,
};

/** The calendar units a `calendar_interval` may name in words. */
const calendarWords: Readonly<Record<string, string>> = {
  minute: '1m',
  hour: '1h',
  day: '1d',
  week: '1w',
  month: '1M',
  quarter: '1q',
  year: '1y',
};

/** Round bucket widths to propose, in seconds. */
const roundWidths = [60, 300, 600, 900, 1800, 3600, 7200, 21_600, 43_200, 86_400, 604_800];

/**
 * The width of an interval as a search writes it, such as `5m`, `1d` or `week`.
 *
 * @param interval - The interval.
 * @returns Its width in milliseconds, or `undefined` when it is not a plain width.
 */
function widthMs(interval: unknown): number | undefined {
  if (typeof interval !== 'string') return undefined;
  const written = calendarWords[interval] ?? interval;
  const match = /^(\d+)(ms|[smhdwMqy])$/.exec(written);
  if (!match) return undefined;
  return Number(match[1]) * (unitMs[match[2] ?? ''] ?? 0) || undefined;
}

/**
 * The time buckets of a date histogram over the range.
 *
 * @param histogram - The `date_histogram` body.
 * @param rangeMs - The time range, in milliseconds.
 * @returns The buckets, one when the width is not a plain one.
 */
function timeBuckets(histogram: Json, rangeMs: number): number {
  const width = widthMs(histogram.fixed_interval ?? histogram.calendar_interval);
  return width ? Math.max(1, Math.ceil(rangeMs / width)) : 1;
}

/**
 * The groups of a grouping: the size of a `terms` or `multi_terms`, the keys of a `filters`.
 *
 * @param body - The aggregation's body.
 * @returns The groups, one for an aggregation that groups nothing.
 */
function groupsOf(body: Json): number {
  const grouping = (body.terms ?? body.multi_terms) as Json | undefined;
  if (grouping) return typeof grouping.size === 'number' ? grouping.size : 10;
  const filters = (body.filters as Json | undefined)?.filters;
  return filters && typeof filters === 'object' ? Object.keys(filters).length : 1;
}

/**
 * The buckets one aggregation makes on its own: the time buckets of a date histogram over the
 * range, or the groups of a grouping.
 *
 * @param body - The aggregation's body.
 * @param rangeMs - The time range, in milliseconds.
 * @returns The buckets.
 */
function ownBuckets(body: Json, rangeMs: number): number {
  const histogram = body.date_histogram as Json | undefined;
  return histogram ? timeBuckets(histogram, rangeMs) : groupsOf(body);
}

/**
 * The buckets a level of aggregations makes, each times what it holds.
 *
 * @param aggs - The level's aggregations, by name.
 * @param rangeMs - The time range, in milliseconds.
 * @returns The most buckets of any aggregation of the level.
 */
function levelBuckets(aggs: unknown, rangeMs: number): number {
  if (typeof aggs !== 'object' || aggs === null) return 1;
  let most = 1;
  for (const body of Object.values(aggs as Record<string, Json>)) {
    const inner = levelBuckets(body.aggs ?? body.aggregations, rangeMs);
    most = Math.max(most, ownBuckets(body, rangeMs) * inner);
  }
  return most;
}

/**
 * The buckets a bound search body asks for over a time range.
 *
 * @param body - The body.
 * @param rangeMs - The time range, in milliseconds.
 * @returns The estimate.
 */
export function searchBuckets(body: Json, rangeMs: number): number {
  return levelBuckets(body.aggs ?? body.aggregations, rangeMs);
}

/**
 * Says why a search asks for too many buckets, and the round interval that fits.
 *
 * @param body - The bound body.
 * @param rangeMs - The dashboard's time range, in milliseconds.
 * @returns The message, or `undefined` when the search fits.
 */
export function bucketProblem(body: Json, rangeMs: number): string | undefined {
  const buckets = searchBuckets(body, rangeMs);
  if (buckets <= maxSearchBuckets) return undefined;
  const inTime = levelBuckets(onlyHistograms(body.aggs ?? body.aggregations), rangeMs);
  const groups = Math.max(1, Math.round(buckets / inTime));
  const fits = roundWidths.find(
    (seconds) => Math.ceil(rangeMs / (seconds * 1000)) * groups <= maxSearchBuckets,
  );
  const advice =
    inTime > 1 && fits
      ? `use an interval of ${label(fits)} or more, or fewer groups`
      : 'ask for fewer groups';
  return `This search makes about ${buckets.toLocaleString('en')} buckets over the dashboard's range, and a search server stops at ${maxSearchBuckets.toLocaleString('en')}: ${advice}.`;
}

/**
 * The date histograms of a tree of aggregations, with every other grouping counted as one.
 *
 * @param aggs - The aggregations.
 * @returns The same tree, its groupings but date histograms set to one bucket.
 */
function onlyHistograms(aggs: unknown): unknown {
  if (typeof aggs !== 'object' || aggs === null) return aggs;
  return Object.fromEntries(
    Object.entries(aggs as Record<string, Json>).map(([name, body]) => {
      const inner = onlyHistograms(body.aggs ?? body.aggregations);
      const kept = body.date_histogram ? { date_histogram: body.date_histogram } : {};
      return [name, { ...kept, aggs: inner }];
    }),
  );
}

/**
 * A width as a person reads it.
 *
 * @param seconds - The width.
 * @returns Such as `5m`, `1h` or `1d`.
 */
function label(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${seconds / 60}m`;
}

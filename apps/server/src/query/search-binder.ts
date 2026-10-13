/**
 * Binds variables into a search template in the Elasticsearch and OpenSearch query DSL. A variable
 * is a JSON node, `{"$var": "service"}`, replaced by the value as a JSON value: never text inside a
 * string. The body may hold no script that reads documents. A `bucket_script` may name one of the
 * fixed ratio scripts, and on a connector that allows bucket scripts a `bucket_script` or a
 * `bucket_selector` may hold an expression of its own (`search-scripts.ts`). Nor may the body
 * hide a query in base64 (`wrapper`) or read documents of another index (a terms lookup, an
 * indexed shape, a percolator, or a `_index` in a document list), which the index check never sees.
 */
import type { SearchQuery, TimeRange } from '../connectors/_shared/index.ts';
import { chosenSeconds } from './interval.ts';
import { bindJsonVariables } from './json-variables.ts';
import { QueryError } from './query-error.ts';
import { boundFormat, isoBound } from './search-dates.ts';
import { periodFields, withBoundsFormat, withFilledHistograms } from './search-histogram.ts';
import { checkScriptKey, isObject } from './search-scripts.ts';
import type { Variables } from './variables.ts';

/** The search template of a panel query. */
export interface SearchTemplate {
  /** The index, index pattern or comma-separated list of them. */
  readonly index: string;
  /** The search body, with `{"$var": "name"}` nodes. */
  readonly body: Readonly<Record<string, unknown>>;
}

/**
 * One index or pattern: lowercase, not hidden (`.`) or special (`_`), no remote cluster (`:`). A
 * leading `-` excludes it from the patterns before it.
 */
const indexItem = /^-?[a-z0-9*][a-z0-9_.*+-]{0,254}$/;

/** One index or pattern of a connector that shows its server's own indices: a dot may lead. */
const systemIndexItem = /^-?[a-z0-9*.][a-z0-9_.*+-]{0,254}$/;

/**
 * An item that is only dots, with or without the `-` of an exclusion. No index has such a name,
 * and alone in a request path `.` and `..` are segments: `/../_search` is a search of every index.
 */
const dotsItem = /^-?\.+$/;

/** Keys that hide a query from this check or read another index, in lowercase: refused in any case. */
const hiddenReadKeys: ReadonlySet<string> = new Set(['wrapper', 'percolate', 'indexed_shape']);

/** The keys whose items name a document, which a `_index` may place in another index. */
const documentListKeys: ReadonlySet<string> = new Set(['like', 'unlike', 'docs']);

export { searchRatioScripts } from '../connectors/_shared/index.ts';

/** Bucket widths `__interval` picks from, in seconds. */
const niceIntervals = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10_800, 21_600, 43_200, 86_400,
  604_800,
];

/** The most buckets `__interval` gives over the time range. */
const maxBuckets = 1000;

/**
 * Checks an index expression.
 *
 * @param index - The index, pattern or comma-separated list.
 * @param showSystem - Whether the connector shows its server's own indices, so a dot may lead.
 * @returns The index.
 * @throws {QueryError} `invalid` for a hidden, system or remote index, or a malformed name.
 */
function checkIndex(index: string, showSystem: boolean): string {
  const items = index.split(',');
  const shape = showSystem ? systemIndexItem : indexItem;
  const wellFormed = items.every((item) => shape.test(item) && !dotsItem.test(item));
  if (items[0]?.startsWith('-') || !wellFormed) {
    throw new QueryError(
      'invalid',
      showSystem
        ? 'An index is lowercase letters, digits, -, _, . and * patterns, with no remote cluster.'
        : 'An index is lowercase letters, digits, -, _, . and * patterns, not hidden (.) or system (_) indices.',
    );
  }
  return index;
}

/**
 * The round bucket width that keeps the time range within {@link maxBuckets} buckets, or within
 * fewer when a chart has room for fewer points.
 *
 * @param timeRange - The time range.
 * @param most - The most buckets, when a chart caps them below {@link maxBuckets}.
 * @returns The width in seconds, such as 30, 300 or 3600.
 */
export function bucketSeconds(timeRange: TimeRange, most = maxBuckets): number {
  const rangeSeconds = (timeRange.to.getTime() - timeRange.from.getTime()) / 1000;
  const buckets = Math.max(1, Math.min(most, maxBuckets));
  return (
    niceIntervals.find((width) => rangeSeconds / width <= buckets) ?? niceIntervals.at(-1) ?? 1
  );
}

/**
 * The bucket width that keeps the time range within {@link maxBuckets} buckets, or within fewer
 * when a chart has room for fewer points.
 *
 * @param timeRange - The time range.
 * @param most - The most buckets, when a chart caps them below {@link maxBuckets}.
 * @returns Such as `30s`, `5m` or `1h`.
 */
export function searchInterval(timeRange: TimeRange, most = maxBuckets): string {
  const seconds = bucketSeconds(timeRange, most);
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

/**
 * Checks every key of a template for scripts, hidden queries and reads of another index, walking
 * the body.
 *
 * @param node - The node.
 * @param bucketScripts - Whether the connector allows a script of the query's own in
 *   `bucket_script` and `bucket_selector`.
 * @param ancestors - The keys of the objects that enclose the node, from the body down.
 * @throws {QueryError} `invalid` for a script the connector does not allow, a wrapper, or a read
 *   of another index.
 */
function refuseScripts(
  node: unknown,
  bucketScripts: boolean,
  ancestors: readonly string[] = [],
): void {
  if (Array.isArray(node)) {
    for (const item of node) refuseScripts(item, bucketScripts, ancestors);
    return;
  }
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    checkScriptKey(key, value, ancestors, bucketScripts);
    refuseHiddenRead(key, value, ancestors.at(-1));
    refuseScripts(value, bucketScripts, [...ancestors, key]);
  }
}

/**
 * Whether a `terms` query looks up its terms in a document: a field whose value names an index.
 *
 * @param value - The value of the `terms` key.
 * @returns `true` for a terms lookup.
 */
function termsLookup(value: unknown): boolean {
  if (!isObject(value)) return false;
  return Object.values(value).some((field) => isObject(field) && 'index' in field);
}

/**
 * Whether a key hides a query or reads documents the index check does not see.
 *
 * @param key - The key.
 * @param value - Its value.
 * @param parent - The key of the enclosing object or list.
 * @returns `true` for a wrapper, a lookup, a percolator or a document of another index.
 */
function readsHidden(key: string, value: unknown, parent: string | undefined): boolean {
  const lower = key.toLowerCase();
  if (hiddenReadKeys.has(lower)) return true;
  if (lower === '_index') return documentListKeys.has(parent?.toLowerCase() ?? '');
  return lower === 'terms' && termsLookup(value);
}

/**
 * Checks one key for a hidden query or a read of another index.
 *
 * @param key - The key.
 * @param value - Its value.
 * @param parent - The key of the enclosing object or list.
 * @throws {QueryError} `invalid` for a wrapper, a lookup, a percolator or another index's document.
 */
function refuseHiddenRead(key: string, value: unknown, parent: string | undefined): void {
  if (!readsHidden(key, value, parent)) return;
  throw new QueryError(
    'invalid',
    `A query reads only what it shows, from its own index; "${key}" is not allowed. Write the query in plain JSON, with its terms inline.`,
  );
}

/** Date math on the server's clock, such as `now`, `now-1h` or `now-7d/d`, which no format reads. */
const dateMath = /^now(?:[+-]\d+[yMwdhHms]|\/[yMwdhHms])*$/;

/** The keys of a range that hold a bound; the others, such as `time_zone`, hold none. */
const boundKeys = ['gt', 'gte', 'lt', 'lte', 'from', 'to'];

/**
 * Whether a range's bounds read in {@link boundFormat}: one is ISO 8601 text, and every other
 * written as text is ISO too, or date math. A format replaces the mapping's for all the bounds, so
 * a bound in the field's own format beside an ISO one would no longer parse.
 *
 * @param bounds - The bounds of one field, with their values bound.
 * @returns `true` when the format fits them all.
 */
function readsAsIso(bounds: Record<string, unknown>): boolean {
  const written = boundKeys.map((key) => bounds[key]).filter((value) => typeof value === 'string');
  return written.some(isoBound) && written.every((text) => isoBound(text) || dateMath.test(text));
}

/**
 * The bounds of a range clause's field, saying how they are written when one is ISO 8601 text.
 * A date field accepts only the formats of its mapping, such as `epoch_millis` alone, and refuses
 * any other with a parse error; a range's own `format` says how its bounds read, whatever the
 * field's.
 *
 * @param bounds - The bounds of one field, such as `{ gte, lte }`, with their values bound.
 * @returns The bounds, with the format when they name none and it fits them all: one is ISO text,
 *   and no other is text in another form.
 */
function withBoundFormat(bounds: unknown): unknown {
  if (!isObject(bounds) || 'format' in bounds) return bounds;
  return readsAsIso(bounds) ? { ...bounds, format: boundFormat } : bounds;
}

/**
 * A search body whose ranges over dates, and whose date histograms with bounds, say how their
 * bounds are written.
 *
 * @param node - A node of the bound body.
 * @param parent - The key the node is under.
 * @returns The node, with the format on each range and each histogram bounded by ISO text.
 */
function withRangeFormats(node: unknown, parent?: string): unknown {
  if (Array.isArray(node)) return node.map((item) => withRangeFormats(item, parent));
  if (!isObject(node)) return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      const child = parent === 'range' ? withBoundFormat(value) : value;
      const read = key === 'date_histogram' ? withBoundsFormat(child) : child;
      return [key, withRangeFormats(read, key)];
    }),
  );
}

/** What binding a search depends on beyond its template, its variables and the time range. */
export interface SearchBinding {
  /** Whether the connector shows its server's own indices, so a dot may lead. */
  readonly showSystem?: boolean | undefined;
  /** Whether the connector allows a script of the query's own in its two bucket aggregations. */
  readonly bucketScripts?: boolean | undefined;
  /** The interval the charts are cut into, when one was chosen: `__interval`. */
  readonly interval?: string | undefined;
  /**
   * Whether a date histogram keeps only the buckets it has, as the query wrote it. An alert reads
   * a result that way: a stretch without a document is no data, never a count of 0.
   */
  readonly sparse?: boolean | undefined;
}

/**
 * Binds a search template. A date histogram over the field the time range filters is filled over
 * the whole range (`search-histogram.ts`), so a chart is never cut to the stretch that has data.
 *
 * @param template - The index and the body.
 * @param variables - The variable values.
 * @param timeRange - The time range, for `__from`, `__to` and `__interval`.
 * @param binding - Whether the connector shows system indices and allows bucket scripts, the
 *   chosen interval, and whether histograms stay as written.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for a malformed index, a script the connector does not allow, a
 *   hidden query, a read of another index, or an unknown variable.
 */
export function bindSearch(
  template: SearchTemplate,
  variables: Variables,
  timeRange: TimeRange,
  binding: SearchBinding = {},
): SearchQuery {
  const { interval } = binding;
  const builtIns = {
    __from: timeRange.from.toISOString(),
    __to: timeRange.to.toISOString(),
    __interval: chosenSeconds(interval) === undefined ? searchInterval(timeRange) : interval,
  };
  refuseScripts(template.body, binding.bucketScripts ?? false);
  const bound = bindJsonVariables(template.body, { variables, builtIns });
  // After binding, so a variable's date and one the query writes itself read the same way.
  const dated = withRangeFormats(bound) as SearchQuery['body'];
  const fields = binding.sparse ? new Map<string, never>() : periodFields(template.body);
  const body = withFilledHistograms(dated, fields, timeRange);
  const index = checkIndex(template.index, binding.showSystem ?? false);
  return { language: 'search', index, body };
}

/**
 * Binds variables into a search template in the Elasticsearch and OpenSearch query DSL. A variable
 * is a JSON node, `{"$var": "service"}`, replaced by the value as a JSON value: never text inside a
 * string. The body may hold no key naming a script, since a script is code the search server runs,
 * except the fixed ratio scripts a `bucket_script` may name: quanthea's own code, not the model's.
 * Nor may it hide a query in base64 (`wrapper`) or read documents of another index (a terms lookup,
 * an indexed shape, a percolator, or a `_index` in a document list), which the index check never
 * sees.
 */
import {
  type SearchQuery,
  searchRatioScripts,
  type TimeRange,
} from '../connectors/_shared/index.ts';
import { bindJsonVariables } from './json-variables.ts';
import { QueryError } from './query-error.ts';
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
 * A key holding or running a script: one with a word starting with `script`, in snake_case or, once
 * `Script` is split off, camelCase. It matches `script` itself, `_script` sorts, `script_fields`,
 * `script_score`, `scripted_metric`, `minimum_should_match_script` and any other, but not a field
 * such as `description`. Runtime fields run scripts too, under {@link runtimeKey}.
 */
const scriptWord = /(?:^|[^a-z])script/i;

/** The key of runtime fields, which run a script for each document. */
const runtimeKey = 'runtime_mappings';

/** Keys that hide a query from this check or read another index, in lowercase: refused in any case. */
const hiddenReadKeys: ReadonlySet<string> = new Set(['wrapper', 'percolate', 'indexed_shape']);

/** The keys whose items name a document, which a `_index` may place in another index. */
const documentListKeys: ReadonlySet<string> = new Set(['like', 'unlike', 'docs']);

/** The aggregation that holds a ratio script: allowed, since its `script` is checked. */
const ratioAggregation = 'bucket_script';

export { searchRatioScripts };

/** The ratio scripts, to check a `bucket_script` against. */
const allowedScripts: ReadonlySet<unknown> = new Set(Object.values(searchRatioScripts));

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
  if (items[0]?.startsWith('-') || !items.every((item) => shape.test(item))) {
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
 * The round bucket width that keeps the time range within {@link maxBuckets} buckets.
 *
 * @param timeRange - The time range.
 * @returns The width in seconds, such as 30, 300 or 3600.
 */
export function bucketSeconds(timeRange: TimeRange): number {
  const rangeSeconds = (timeRange.to.getTime() - timeRange.from.getTime()) / 1000;
  return (
    niceIntervals.find((width) => rangeSeconds / width <= maxBuckets) ?? niceIntervals.at(-1) ?? 1
  );
}

/**
 * The bucket width that keeps the time range within {@link maxBuckets} buckets.
 *
 * @param timeRange - The time range.
 * @returns Such as `30s`, `5m` or `1h`.
 */
export function searchInterval(timeRange: TimeRange): string {
  const seconds = bucketSeconds(timeRange);
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

/**
 * Whether a key that names a script is one the template may keep: the `bucket_script` aggregation,
 * and its ratio script, named verbatim.
 *
 * @param key - The key.
 * @param value - Its value.
 * @param parent - The key of the enclosing object.
 * @returns `true` for an allowed ratio script.
 */
function allowedScript(key: string, value: unknown, parent: string | undefined): boolean {
  if (key === ratioAggregation) return true;
  return key === 'script' && parent === ratioAggregation && allowedScripts.has(value);
}

/**
 * Whether a key names a script or runtime fields, in any case.
 *
 * @param key - The key.
 * @returns `true` when the key holds or runs a script.
 */
function scriptKey(key: string): boolean {
  return scriptWord.test(key.replace(/Script/g, '_script')) || key.toLowerCase() === runtimeKey;
}

/**
 * Checks every key of a template for scripts, hidden queries and reads of another index, walking
 * the body.
 *
 * @param node - The node.
 * @param parent - The key of the enclosing object.
 * @throws {QueryError} `invalid` for a script other than a ratio script in a `bucket_script`, a
 *   wrapper, or a read of another index.
 */
function refuseScripts(node: unknown, parent?: string): void {
  if (node === null || typeof node !== 'object') return;
  const entries = Array.isArray(node)
    ? node.map((item): [string | undefined, unknown] => [parent, item])
    : Object.entries(node);
  for (const [key, value] of entries) {
    if (!Array.isArray(node) && key !== undefined) checkKey(key, value, parent);
    refuseScripts(value, key);
  }
}

/**
 * Checks one key for a script, a hidden query or a read of another index.
 *
 * @param key - The key.
 * @param value - Its value.
 * @param parent - The key of the enclosing object.
 * @throws {QueryError} `invalid` for a key the template may not hold.
 */
function checkKey(key: string, value: unknown, parent: string | undefined): void {
  refuseScriptKey(key, value, parent);
  refuseHiddenRead(key, value, parent);
}

/**
 * Checks one key for a script.
 *
 * @param key - The key.
 * @param value - Its value.
 * @param parent - The key of the enclosing object.
 * @throws {QueryError} `invalid` for a script other than a ratio script in a `bucket_script`.
 */
function refuseScriptKey(key: string, value: unknown, parent: string | undefined): void {
  if (!scriptKey(key) || allowedScript(key, value, parent)) return;
  throw new QueryError(
    'invalid',
    `A query runs no script; "${key}" is not allowed. Use aggregations and filters, or a bucket_script with a ratio script.`,
  );
}

/**
 * Whether a value is a JSON object, not an array or null.
 *
 * @param value - The value.
 * @returns `true` for an object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

/**
 * The formats a range's bounds are read in when one is ISO 8601 text: that text, as `__from` and
 * `__to` are bound and as a model writes a date, or epoch milliseconds for a bound given as a number.
 */
const boundFormat = 'strict_date_optional_time||epoch_millis';

/**
 * A date or a time in ISO 8601: `2026-10-05`, `2026-10-05T14:47`, `2026-10-05T14:47:01.250Z`,
 * with an offset or without, and any date math after `||`.
 */
const isoText =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}(?::\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?(?:\|\|.*)?$/;

/**
 * Whether a value is a date or a time written as ISO 8601 text.
 *
 * @param value - The value.
 * @returns `true` for such as `2026-10-05T14:47:01Z`, `false` for a number or any other text.
 */
function isoBound(value: unknown): boolean {
  return typeof value === 'string' && isoText.test(value);
}

/**
 * The bounds of a range clause's field, saying how they are written when one is ISO 8601 text.
 * A date field accepts only the formats of its mapping, such as `epoch_millis` alone, and refuses
 * any other with a parse error; a range's own `format` says how its bounds read, whatever the
 * field's.
 *
 * @param bounds - The bounds of one field, such as `{ gte, lte }`, with their values bound.
 * @returns The bounds, with the format when one is ISO text and they name no format.
 */
function withBoundFormat(bounds: unknown): unknown {
  if (!isObject(bounds) || 'format' in bounds) return bounds;
  return Object.values(bounds).some(isoBound) ? { ...bounds, format: boundFormat } : bounds;
}

/**
 * A search body whose ranges over dates say how their bounds are written.
 *
 * @param node - A node of the bound body.
 * @param parent - The key the node is under.
 * @returns The node, with the format on each range bounded by ISO text.
 */
function withRangeFormats(node: unknown, parent?: string): unknown {
  if (Array.isArray(node)) return node.map((item) => withRangeFormats(item, parent));
  if (!isObject(node)) return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      const child = parent === 'range' ? withBoundFormat(value) : value;
      return [key, withRangeFormats(child, key)];
    }),
  );
}

/**
 * Binds a search template.
 *
 * @param template - The index and the body.
 * @param variables - The variable values.
 * @param timeRange - The time range, for `__from`, `__to` and `__interval`.
 * @param showSystem - Whether the connector shows its server's own indices, so a dot may lead.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for a malformed index, a script, a hidden query, a read of
 *   another index, or an unknown variable.
 */
export function bindSearch(
  template: SearchTemplate,
  variables: Variables,
  timeRange: TimeRange,
  showSystem = false,
): SearchQuery {
  const builtIns = {
    __from: timeRange.from.toISOString(),
    __to: timeRange.to.toISOString(),
    __interval: searchInterval(timeRange),
  };
  refuseScripts(template.body);
  const bound = bindJsonVariables(template.body, { variables, builtIns });
  // After binding, so a variable's date and one the query writes itself read the same way.
  const body = withRangeFormats(bound) as SearchQuery['body'];
  return { language: 'search', index: checkIndex(template.index, showSystem), body };
}

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
 * @returns The index.
 * @throws {QueryError} `invalid` for a hidden, system or remote index, or a malformed name.
 */
function checkIndex(index: string): string {
  const items = index.split(',');
  if (items[0]?.startsWith('-') || !items.every((item) => indexItem.test(item))) {
    throw new QueryError(
      'invalid',
      'An index is lowercase letters, digits, -, _, . and * patterns, not hidden (.) or system (_) indices.',
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
 * Binds a search template.
 *
 * @param template - The index and the body.
 * @param variables - The variable values.
 * @param timeRange - The time range, for `__from`, `__to` and `__interval`.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for a malformed index, a script, a hidden query, a read of
 *   another index, or an unknown variable.
 */
export function bindSearch(
  template: SearchTemplate,
  variables: Variables,
  timeRange: TimeRange,
): SearchQuery {
  const builtIns = {
    __from: timeRange.from.toISOString(),
    __to: timeRange.to.toISOString(),
    __interval: searchInterval(timeRange),
  };
  refuseScripts(template.body);
  const body = bindJsonVariables(template.body, { variables, builtIns });
  return { language: 'search', index: checkIndex(template.index), body };
}

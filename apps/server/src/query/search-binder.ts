/**
 * Binds variables into a search template in the Elasticsearch and OpenSearch query DSL. A variable
 * is a JSON node, `{"$var": "service"}`, replaced by the value as a JSON value: never text inside a
 * string. The body may hold no script, since a script is code the search server runs, except the
 * fixed ratio scripts a `bucket_script` may name: quanthea's own code, not the model's.
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
 * Keys that hold or run a script, which a template may not use: `script` itself (inside
 * `script_score`, `bucket_script`, `bucket_selector`, `moving_fn` and the rest), sorting by script,
 * script fields, scripted metrics and runtime fields.
 */
const scriptKeys = new Set([
  'script',
  '_script',
  'scripts',
  'script_fields',
  'script_score',
  'scripted_metric',
  'runtime_mappings',
]);

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
 * Whether a key holds a script the template may keep: a ratio script, named verbatim, directly in
 * a `bucket_script`.
 *
 * @param key - The key.
 * @param value - Its value.
 * @param parent - The key of the enclosing object.
 * @returns `true` for an allowed ratio script.
 */
function allowedScript(key: string, value: unknown, parent: string | undefined): boolean {
  return key === 'script' && parent === 'bucket_script' && allowedScripts.has(value);
}

/**
 * Checks every key of a template for scripts, walking the body.
 *
 * @param node - The node.
 * @param parent - The key of the enclosing object.
 * @throws {QueryError} `invalid` for a script other than a ratio script in a `bucket_script`.
 */
function refuseScripts(node: unknown, parent?: string): void {
  if (node === null || typeof node !== 'object') return;
  const entries = Array.isArray(node)
    ? node.map((item): [string | undefined, unknown] => [parent, item])
    : Object.entries(node);
  for (const [key, value] of entries) {
    if (!Array.isArray(node) && key !== undefined) refuseScriptKey(key, value, parent);
    refuseScripts(value, key);
  }
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
  if (!scriptKeys.has(key.toLowerCase()) || allowedScript(key, value, parent)) return;
  throw new QueryError(
    'invalid',
    `A query runs no script; "${key}" is not allowed. Use aggregations and filters, or a bucket_script with a ratio script.`,
  );
}

/**
 * Binds a search template.
 *
 * @param template - The index and the body.
 * @param variables - The variable values.
 * @param timeRange - The time range, for `__from`, `__to` and `__interval`.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for a malformed index, a script, or an unknown variable.
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

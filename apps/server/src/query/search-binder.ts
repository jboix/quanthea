/**
 * Binds variables into a search template in the Elasticsearch and OpenSearch query DSL. A variable
 * is a JSON node, `{"$var": "service"}`, replaced by the value as a JSON value: never text inside a
 * string. The body may hold no script, since a script is code the search server runs.
 */
import type { SearchQuery, TimeRange } from '../connectors/_shared/index.ts';
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

/** How deep a body may nest. */
const maxDepth = 64;

/** Bucket widths `__interval` picks from, in seconds. */
const niceIntervals = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10_800, 21_600, 43_200, 86_400,
  604_800,
];

/** The most buckets `__interval` gives over the time range. */
const maxBuckets = 1000;

/** What binding a body needs. */
interface BindContext {
  /** The variable values. */
  readonly variables: Variables;
  /** The built-in values: `__from`, `__to` and `__interval`. */
  readonly builtIns: Readonly<Record<string, string>>;
}

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
 * The bucket width that keeps the time range within {@link maxBuckets} buckets.
 *
 * @param timeRange - The time range.
 * @returns Such as `30s`, `5m` or `1h`.
 */
export function searchInterval(timeRange: TimeRange): string {
  const rangeSeconds = (timeRange.to.getTime() - timeRange.from.getTime()) / 1000;
  const seconds =
    niceIntervals.find((width) => rangeSeconds / width <= maxBuckets) ?? niceIntervals.at(-1) ?? 1;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

/**
 * The value of a `{"$var": "name"}` node: one value as a string, a multi-value variable as a list.
 *
 * @param node - The node.
 * @param context - The variables and built-ins.
 * @returns The value.
 * @throws {QueryError} `invalid` for a node with other keys, or an unknown variable.
 */
function variableValue(node: Readonly<Record<string, unknown>>, context: BindContext): unknown {
  const name = node.$var;
  if (typeof name !== 'string' || Object.keys(node).length !== 1) {
    throw new QueryError('invalid', 'A variable is a node of its own: {"$var": "service"}.');
  }
  const builtIn = context.builtIns[name];
  if (builtIn !== undefined) return builtIn;
  const binding = context.variables[name];
  if (!binding) throw new QueryError('invalid', `Unknown variable ${name}.`);
  return typeof binding.value === 'string' ? binding.value : [...binding.value];
}

/**
 * Checks one key of a body object.
 *
 * @param key - The key.
 * @throws {QueryError} `invalid` for a script, or a `$` key other than a variable node.
 */
function checkKey(key: string): void {
  if (scriptKeys.has(key.toLowerCase())) {
    throw new QueryError(
      'invalid',
      `A query runs no script; "${key}" is not allowed. Use aggregations and filters instead.`,
    );
  }
  if (key.startsWith('$')) {
    throw new QueryError('invalid', `"${key}" is not a variable; write {"$var": "name"}.`);
  }
}

/**
 * Binds one JSON node and everything under it.
 *
 * @param node - The node.
 * @param context - The variables and built-ins.
 * @param depth - How deep the node is.
 * @returns The bound node.
 * @throws {QueryError} `invalid` for a script, an unknown variable or a body nested too deep.
 */
function bindNode(node: unknown, context: BindContext, depth: number): unknown {
  if (depth > maxDepth) throw new QueryError('invalid', 'The query body nests too deep.');
  if (Array.isArray(node)) return node.map((item) => bindNode(item, context, depth + 1));
  if (node === null || typeof node !== 'object') return node;
  const object = node as Readonly<Record<string, unknown>>;
  if ('$var' in object) return variableValue(object, context);
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => {
      checkKey(key);
      return [key, bindNode(value, context, depth + 1)];
    }),
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
  const body = bindNode(template.body, { variables, builtIns }, 0) as Record<string, unknown>;
  return { language: 'search', index: checkIndex(template.index), body };
}

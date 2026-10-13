/**
 * The scripts a search may hold. A script that reads documents is refused in every case: it would
 * go around hidden fields and access levels. A `bucket_script` may name one of the two fixed ratio
 * scripts on every connector. On a connector whose admin allows bucket scripts, `bucket_script` and
 * `bucket_selector` may also hold a script of their own: it receives only the numbers of the
 * buckets it names, and here it is kept to one arithmetic expression over them.
 */
import { searchRatioScripts, searchScriptLength } from '../connectors/_shared/index.ts';
import { QueryError } from './query-error.ts';

/**
 * A key holding or running a script: one with a word starting with `script`, in snake_case or, once
 * `Script` is split off, camelCase. It matches `script` itself, `_script` sorts, `script_fields`,
 * `script_score`, `scripted_metric`, `minimum_should_match_script` and any other, but not a field
 * such as `description`. Runtime fields run scripts too, under {@link runtimeKey}.
 */
const scriptWord = /(?:^|[^a-z])script/i;

/** The key of runtime fields, which run a script for each document. */
const runtimeKey = 'runtime_mappings';

/** The aggregation that holds a ratio script. */
const ratioAggregation = 'bucket_script';

/** The aggregations whose script receives the numbers of the buckets it names, and no document. */
const bucketAggregations: ReadonlySet<string> = new Set([ratioAggregation, 'bucket_selector']);

/** The keys an aggregation is declared under. */
const aggregationKeys: ReadonlySet<string | undefined> = new Set(['aggs', 'aggregations']);

/** The ratio scripts, to check a `bucket_script` against. */
const ratioScripts: ReadonlySet<unknown> = new Set(Object.values(searchRatioScripts));

/** The keys of a script written as an object. */
const scriptKeys: ReadonlySet<string> = new Set(['source', 'params', 'lang']);

/**
 * One token of a bucket script: a number, a value of `params`, `null`, `true` or `false`, a `Math`
 * function, `Double.parseDouble` for a variable's value, which arrives as text, a parenthesis, or
 * an operator of arithmetic, comparison or logic. There is no token
 * for a statement, a loop, a string, `new`, a bracket or a method call: a script with a loop or an
 * allocation can exhaust the search server's memory, which neither server bounds.
 */
const token =
  /(?<space>\s+)|(?<operand>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])|params\.[A-Za-z_]\w*(?![\w.])|(?:null|true|false)(?![\w.])|\))|(?<call>(?:Math\.(?:abs|ceil|exp|floor|log|log10|max|min|pow|round|sqrt)|Double\.parseDouble)(?=\s*\())|(?<open>\()|==|!=|<=|>=|&&|\|\||[-+*/%<>!?:,]/y;

/** What a script's text may hold, for the refusal. */
const expressionOnly =
  'A bucket script is one expression: numbers, params.name, + - * / %, comparisons, && || !, ? :, parentheses, Math.abs, ceil, exp, floor, log, log10, max, min, pow, round or sqrt, and Double.parseDouble(params.name) for a variable passed in params. Statements, loops, strings and other calls are refused.';

/** What to say of a script of the query's own on a connector that does not allow one. */
const notAllowedHere =
  "This connector allows no script of the query's own: only the two ratio scripts, in a bucket_script. An admin can allow scripts in bucket_script and bucket_selector in the connector's settings. Until then, use a ratio script, or aggregations and filters.";

/**
 * Whether a value is a JSON object, not an array or null.
 *
 * @param value - The value.
 * @returns `true` for an object.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
 * Whether a text is one expression of the tokens a bucket script may hold. A parenthesis never
 * follows a value, so no value is called as a method.
 *
 * @param source - The script text.
 * @returns `true` for an expression.
 */
function isExpression(source: string): boolean {
  let afterOperand = false;
  for (let at = 0; at < source.length; at = token.lastIndex) {
    token.lastIndex = at;
    const groups = token.exec(source)?.groups;
    if (!groups || (groups.open !== undefined && afterOperand)) return false;
    if (groups.space === undefined) afterOperand = groups.operand !== undefined;
  }
  return source.trim() !== '';
}

/**
 * What is wrong with a script written as an object, before its text is read.
 *
 * @param script - The object.
 * @returns The problem, or `undefined`.
 */
function objectProblem(script: Readonly<Record<string, unknown>>): string | undefined {
  if ('$var' in script || isObject(script.source))
    return 'The text of a bucket script holds no variable. Pass the value in "params", as "params": {"min": {"$var": "threshold"}}, and read it as params.min.';
  if (Object.keys(script).some((key) => !scriptKeys.has(key)))
    return 'A bucket script is written in the query: text, or {"source": text, "params": {…}}. A stored script ("id") and any other key are refused.';
  if (script.lang !== undefined && script.lang !== 'painless')
    return 'A bucket script is Painless: leave "lang" out, or write "painless".';
  if (script.params !== undefined && !isObject(script.params))
    return 'The "params" of a bucket script is an object of values, such as {"min": 100}.';
  return undefined;
}

/**
 * What is wrong with a script of the query's own.
 *
 * @param script - The value of the `script` key.
 * @returns The problem, or `undefined` for a script that may run.
 */
function scriptProblem(script: unknown): string | undefined {
  const problem = isObject(script) ? objectProblem(script) : undefined;
  if (problem !== undefined) return problem;
  const source = isObject(script) ? script.source : script;
  if (typeof source !== 'string')
    return 'A bucket script is text, or {"source": text, "params": {…}}.';
  if (source.length > searchScriptLength)
    return `A bucket script is at most ${searchScriptLength} characters: one expression over the buckets it names.`;
  return isExpression(source) ? undefined : expressionOnly;
}

/**
 * Whether an aggregation names the buckets its script reads: an object of paths.
 *
 * @param aggregation - The body of a `bucket_script` or `bucket_selector`.
 * @returns `true` when `buckets_path` maps at least one name to a path.
 */
function namesBuckets(aggregation: Readonly<Record<string, unknown>>): boolean {
  const paths = aggregation.buckets_path;
  if (!isObject(paths)) return false;
  const values = Object.values(paths);
  return values.length > 0 && values.every((path) => typeof path === 'string');
}

/**
 * Whether a script is one of the two ratio scripts, in the aggregation that may name them.
 *
 * @param script - The value of the `script` key.
 * @param aggregation - The key of the aggregation that holds it.
 * @returns `true` for a ratio script named verbatim in a `bucket_script`.
 */
function ratioScript(script: unknown, aggregation: string | undefined): boolean {
  return aggregation === ratioAggregation && ratioScripts.has(script);
}

/**
 * Checks a `bucket_script` or `bucket_selector` that holds a script of the query's own, on a
 * connector that allows one: it is an aggregation, and it names its buckets.
 *
 * @param key - The aggregation's key.
 * @param value - Its body.
 * @param ancestors - The keys from the body down to the aggregation's name.
 * @throws {QueryError} `invalid` when it is not under `aggs`, or has no `buckets_path`.
 */
function checkBucketAggregation(key: string, value: unknown, ancestors: readonly string[]): void {
  if (!isObject(value) || value.script === undefined || ratioScript(value.script, key)) return;
  if (!aggregationKeys.has(ancestors.at(-2)))
    throw new QueryError(
      'invalid',
      `A ${key} with a script of its own is an aggregation: write it under "aggs", beside the aggregations it reads.`,
    );
  if (!namesBuckets(value))
    throw new QueryError(
      'invalid',
      `A ${key} names the buckets its script reads in "buckets_path", as {"errors": "errors>_count"}: the script receives those numbers and nothing else.`,
    );
}

/**
 * Checks the script of a `bucket_script` or `bucket_selector`.
 *
 * @param script - The value of the `script` key.
 * @param aggregation - The key of the aggregation that holds it.
 * @param bucketScripts - Whether the connector allows a script of the query's own there.
 * @throws {QueryError} `invalid` for a script the connector does not allow, or one that is not an
 *   inline expression.
 */
function checkBucketScript(script: unknown, aggregation: string, bucketScripts: boolean): void {
  if (ratioScript(script, aggregation)) return;
  if (!bucketScripts) throw new QueryError('invalid', notAllowedHere);
  const problem = scriptProblem(script);
  if (problem !== undefined) throw new QueryError('invalid', problem);
}

/**
 * Refuses a key that holds a script reading documents.
 *
 * @param key - The key.
 * @param bucketScripts - Whether the connector allows bucket scripts, for what to use instead.
 * @throws {QueryError} `invalid`, in every case.
 */
function refuseDocumentScript(key: string, bucketScripts: boolean): never {
  const instead = bucketScripts
    ? 'a script in a bucket_script or bucket_selector'
    : 'a bucket_script with a ratio script';
  throw new QueryError(
    'invalid',
    `A query runs no script that reads documents; "${key}" is not allowed, whatever the connector's settings. Use aggregations and filters, or ${instead}.`,
  );
}

/**
 * Checks one key of a search body for a script.
 *
 * @param key - The key.
 * @param value - Its value.
 * @param ancestors - The keys of the objects that enclose it, from the body down.
 * @param bucketScripts - Whether the connector allows a script of the query's own in
 *   `bucket_script` and `bucket_selector`.
 * @throws {QueryError} `invalid` for a script that reads documents, and for a bucket script the
 *   connector does not allow or that breaks its limits.
 */
export function checkScriptKey(
  key: string,
  value: unknown,
  ancestors: readonly string[],
  bucketScripts: boolean,
): void {
  if (bucketAggregations.has(key)) {
    if (bucketScripts) checkBucketAggregation(key, value, ancestors);
    return;
  }
  if (!scriptKey(key)) return;
  const parent = ancestors.at(-1);
  if (key !== 'script' || parent === undefined || !bucketAggregations.has(parent))
    refuseDocumentScript(key, bucketScripts);
  checkBucketScript(value, parent, bucketScripts);
}

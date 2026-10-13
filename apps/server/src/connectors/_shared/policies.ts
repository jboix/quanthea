/**
 * What the core allows in each query language, beyond binding: the lists the binders and the
 * built-in connectors check against. They are quanthea's policy, so the public kit leaves them out.
 */
/**
 * The scripts a search's `bucket_script` may run, verbatim: the share of `part` in `whole`, and one
 * minus it. They are quanthea's code; a query names one, never writes one.
 */
export const searchRatioScripts = {
  ratio: 'params.whole > 0 ? params.part / params.whole : 0',
  complement: 'params.whole > 0 ? 1 - params.part / params.whole : 0',
} as const;

/**
 * The longest text of a bucket script of a query's own. An expression over a few bucket numbers is
 * a line: the ratio scripts are about 50 characters. A cap also bounds what the search server
 * compiles and keeps.
 */
export const searchScriptLength = 300;

/**
 * What the search guide says of scripts, by what the connectors of the kind allow. A connector
 * whose admin allows bucket scripts takes an expression of the query's own in `bucket_script` and
 * `bucket_selector`; every other keeps to the ratio scripts.
 *
 * @param allowing - The names of the kind's connectors that allow bucket scripts.
 * @param others - The names of those that do not.
 * @returns The lines to end the guide with.
 */
export function searchScriptGuide(allowing: readonly string[], others: readonly string[]): string {
  const off = `On a connector the catalog marks "bucket scripts: off"${others.length > 0 ? ` (${others.join(', ')})` : ''}, keep to the ratio scripts. When the person needs another script there, say that an admin can allow bucket scripts in the connector's settings, and do not try one: it is refused.`;
  if (allowing.length === 0) return `- bucket scripts: off on every connector of this kind. ${off}`;
  return `- bucket scripts, on a connector the catalog marks "bucket scripts: allowed" (${allowing.join(', ')}): a bucket_script or a bucket_selector may hold one expression of your own over the buckets it names in "buckets_path", which is required.
  - a difference of two counts, under a bucket: {"_errors": {"filter": …}, "_warnings": {"filter": …}, "more": {"bucket_script": {"buckets_path": {"errors": "_errors>_count", "warnings": "_warnings>_count"}, "script": "params.errors - params.warnings"}}}.
  - only the buckets above a number: {"_busy": {"bucket_selector": {"buckets_path": {"count": "_count"}, "script": {"source": "params.count > params.min", "params": {"min": 100}}}}}; the leading _ keeps its empty column out of the table.
  - The expression holds numbers, params.name, + - * / %, comparisons, && || !, ? :, parentheses and Math.abs, ceil, exp, floor, log, log10, max, min, pow, round or sqrt, in at most ${searchScriptLength} characters. No statements, loops, strings or other calls, and no stored script.
  - A value that changes goes in "params", never in the text: the search server compiles each distinct text and limits how many it compiles. A variable goes there as {"min": {"$var": "threshold"}} and arrives as text: read it as Double.parseDouble(params.min).
  - Every other script reads documents and is refused on every connector: script_fields, runtime fields, scripted_metric, script queries, sorts and scores.
- ${off}`;
}

/**
 * The Redis and Valkey commands a query may run: reads of one key or a few, and server
 * information. Nothing that writes, scans every key, or runs a script.
 */
export const redisReadCommands: ReadonlySet<string> = new Set([
  'GET',
  'MGET',
  'STRLEN',
  'EXISTS',
  'TYPE',
  'TTL',
  'PTTL',
  'HGET',
  'HMGET',
  'HGETALL',
  'HKEYS',
  'HVALS',
  'HLEN',
  'HEXISTS',
  'LRANGE',
  'LLEN',
  'LINDEX',
  'SMEMBERS',
  'SCARD',
  'SISMEMBER',
  'ZRANGE',
  'ZREVRANGE',
  'ZRANGEBYSCORE',
  'ZREVRANGEBYSCORE',
  'ZCARD',
  'ZCOUNT',
  'ZSCORE',
  'ZRANK',
  'ZREVRANK',
  'XRANGE',
  'XREVRANGE',
  'XLEN',
  'INFO',
  'DBSIZE',
]);

/**
 * The keys a MongoDB pipeline may not hold anywhere, with why: stages that write, wait for changes
 * or read the server's operations, sessions, queries, plans and catalog, and operators that run
 * JavaScript.
 */
export const mongodbRefusedKeys: ReadonlyMap<string, string> = new Map([
  ['$out', 'writes a collection'],
  ['$merge', 'writes a collection'],
  ['$where', 'runs JavaScript'],
  ['$function', 'runs JavaScript'],
  ['$accumulator', 'runs JavaScript'],
  ['$changeStream', 'waits for changes'],
  ['$changeStreamSplitLargeEvent', 'waits for changes'],
  ['$currentOp', "reads the server's operations"],
  ['$listSessions', "reads the server's sessions"],
  ['$listLocalSessions', "reads the server's sessions"],
  ['$listSampledQueries', "reads the server's queries"],
  ['$queryStats', "reads the server's queries"],
  ['$planCacheStats', "reads the server's query plans"],
  ['$listCatalog', "reads the server's catalog"],
  ['$listClusterCatalog', "reads the server's catalog"],
  ['$indexStats', "reads the server's index statistics"],
  ['$collStats', "reads the server's collection statistics"],
  ['$listSearchIndexes', "reads the server's search indexes"],
]);

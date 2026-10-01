/**
 * What the core allows in each query language, beyond binding: the lists the binders and the
 * built-in connectors check against. They are querent's policy, so the public kit leaves them out.
 */
/**
 * The scripts a search's `bucket_script` may run, verbatim: the share of `part` in `whole`, and one
 * minus it. They are querent's code; a query names one, never writes one.
 */
export const searchRatioScripts = {
  ratio: 'params.whole > 0 ? params.part / params.whole : 0',
  complement: 'params.whole > 0 ? 1 - params.part / params.whole : 0',
} as const;

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
 * or read the server's operations and sessions, and operators that run JavaScript.
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
]);

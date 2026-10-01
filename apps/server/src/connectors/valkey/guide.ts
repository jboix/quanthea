/**
 * How to get data from Valkey or Redis, for the agent. It is about data, not charts: any chart
 * recipe for the shape can draw the result.
 */

/** The guide. */
export const valkeyGuide = `Valkey or Redis (one read command per query). The catalog groups keys into patterns such as service:*, with their type. A query is a command and its arguments; $name goes in an argument, $__from_ms and $__to_ms are the time range in epoch milliseconds.
- long by category (ranking): ZREVRANGE errors:by_reason 0 9 WITHSCORES gives member and score.
- a record: HGETALL service:$service gives field and value; HMGET picks fields.
- single: GET, HGET, ZSCORE, ZCARD, LLEN, XLEN give one value.
- several values side by side: MGET key1 key2 gives key and value.
- over time: XRANGE stream $__from_ms $__to_ms gives id, time and a column per field; ZRANGEBYSCORE key $__from_ms $__to_ms WITHSCORES when scores are times.
- rows: LRANGE list 0 99, SMEMBERS set.
- Bound every range: a query never reads a whole large list or set.`;

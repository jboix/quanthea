/**
 * Whether a query cuts time by a step of its own instead of the interval the server binds: SQL
 * that selects or groups by time truncated or binned to a literal width, a search or MongoDB
 * histogram of a literal width, or a PromQL or LogQL range query with a `step`. A report's run
 * and an alert's checks cut such a query as it says, whatever the period or the window.
 *
 * The check reads the spellings the builders and the guides write. Others pass it, such as a
 * cast to a date or a formatted time: it is advice to the agent, not a boundary.
 */
import { followsChartInterval } from './chart-interval.ts';
import type { QueryTemplate } from './queries.ts';
import { sqlCodeOf } from './sql-code.ts';

/**
 * SQL that truncates or bins time by a literal width, in the dialects the builders write, read
 * over the statement's code, where a string is `''`.
 */
const sqlFixedBuckets: readonly RegExp[] = [
  /\b(?:date_trunc|date_bin|time_bucket|time_bucket_gapfill)\s*\(\s*(?:interval\s*)?''/gi,
  /\btoStartOf(?:Second|Minute|FiveMinutes?|TenMinutes|FifteenMinutes|Hour|Day|Week|Month)\s*\(/gi,
  /\btoStartOfInterval\s*\([^()]*,\s*(?:interval\s+\d|toInterval\w+\s*\(\s*\d)/gi,
  /\b(?:unix_timestamp|toUnixTimestamp|to_unixtime)\s*\([^()]*\)\s*[/,]\s*\d/gi,
  /\bextract\s*\(\s*epoch\s+from\s[^()]*\)\s*\/\s*\d/gi,
];

/** The words that open a clause of a statement. */
const clauseStart = /\b(select|where|having|on|group\s+by|order\s+by)\b/gi;

/** The clauses that only filter rows: a truncation there bounds the rows, it buckets nothing. */
const filterClauses: ReadonlySet<string> = new Set(['where', 'having', 'on']);

/**
 * Whether a place in a statement is in a clause that only filters rows.
 *
 * @param code - The statement's code.
 * @param index - The place.
 * @returns `true` when the nearest clause before it is WHERE, HAVING or ON.
 */
function inFilter(code: string, index: number): boolean {
  const clause = [...code.slice(0, index).matchAll(clauseStart)].at(-1)?.[1] ?? '';
  return filterClauses.has(clause.toLowerCase());
}

/**
 * Whether a SQL statement selects or groups by time cut to a literal width. A truncation that
 * only bounds the rows, such as `created_at >= date_trunc('day', :__to)`, is not a bucket.
 *
 * @param sql - The statement.
 * @returns Whether it does.
 */
function hasSqlBucket(sql: string): boolean {
  const code = sqlCodeOf(sql);
  return sqlFixedBuckets.some((pattern) =>
    [...code.matchAll(pattern)].some((match) => !inFilter(code, match.index)),
  );
}

/** A date histogram of a search whose width is written out. */
const searchFixedBucket = /"(?:fixed_interval|calendar_interval)":"/;

/** A `$dateTrunc` of a MongoDB pipeline whose bin size is not a variable. */
const mongodbFixedBucket = /"\$dateTrunc":\{(?![^{}]*"binSize":\{)/;

/** What to write instead of a fixed step, by query language. */
const instead = {
  sql: 'the query cuts time by a fixed width: bucket by the interval instead, "bucket": "$__interval" in a builder or :__interval in raw SQL, such as date_bin(:__interval::interval, created_at, :__from) in PostgreSQL',
  search:
    'the date histogram has a fixed width: use "fixed_interval": {"$var": "__interval"}, or leave "interval" out of a builder',
  mongodb:
    'the $dateTrunc has a fixed width: use "unit": "millisecond" with "binSize": {"$var": "__interval_ms"}, or leave "interval" out of a builder',
  step: 'the query sets its own step: leave "step" out, the server sets it',
} as const;

/**
 * Whether a query in a bucketed language cuts time by a literal width.
 *
 * @param query - A SQL, search or MongoDB query; any other has no buckets to cut.
 * @returns Whether it does.
 */
function hasFixedBucket(query: QueryTemplate): boolean {
  if (query.language === 'sql') return hasSqlBucket(query.sql);
  if (query.language === 'search') return searchFixedBucket.test(JSON.stringify(query.body));
  if (query.language === 'mongodb') return mongodbFixedBucket.test(JSON.stringify(query.pipeline));
  return false;
}

/**
 * Why a query cuts time by a step of its own, if it does.
 *
 * @param query - The query.
 * @returns What to write instead, or `undefined` when the query follows the interval or does not
 *   cut time at all.
 */
export function fixedStepOf(query: QueryTemplate): string | undefined {
  if (query.language === 'promql' || query.language === 'logql') {
    const literal = query.instant !== true && /^\d/.test(query.step ?? '');
    return literal ? instead.step : undefined;
  }
  if (followsChartInterval(query) || !hasFixedBucket(query)) return undefined;
  return instead[query.language as 'sql' | 'search' | 'mongodb'];
}

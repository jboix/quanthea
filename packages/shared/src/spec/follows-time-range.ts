/**
 * Whether a query follows the dashboard's time range: its result covers the range the person
 * picked. A chart of such a query shows the whole range on its time axis; a chart of a query that
 * names its own time shows what the query returned.
 */
import type { QueryTemplate } from './queries.ts';
import { sqlCodeOf } from './sql-code.ts';

/** The built-ins a query filters its time with, in any query language. */
const rangeBuiltIns = /__(?:from|to)(?:_ms|_s)?\b/;

/**
 * Whether a query follows the time range. A PromQL or LogQL range query always does: it is
 * evaluated from the start to the end of the range. Any other query does when it names the start
 * or the end: `:__from` or `:__to` in SQL, outside its comments and strings, `__from` or `__to` in
 * a search, a MongoDB pipeline, an HTTP request or a Redis command.
 *
 * @param query - The query.
 * @returns `true` when the time range bounds its result.
 */
export function followsTimeRange(query: QueryTemplate): boolean {
  if (query.language === 'promql' || query.language === 'logql') return query.instant !== true;
  if (query.language === 'sql') return rangeBuiltIns.test(sqlCodeOf(query.sql));
  const { connector: _connector, ...written } = query;
  return rangeBuiltIns.test(JSON.stringify(written));
}

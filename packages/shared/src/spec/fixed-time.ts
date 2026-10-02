/**
 * Whether a query names a fixed time instead of following the dashboard's time range: SQL that
 * compares with a literal date or reads the current time, or an instant PromQL or LogQL query over
 * a fixed window. Such a panel shows the same moment whatever the person picks.
 */
import type { PanelQuery } from './queries.ts';

/** A literal date in SQL, such as `'2026-10-01 13:00:00'`. */
const sqlDate = /'\d{4}-\d{2}-\d{2}/;

/** SQL that reads the current time. */
const sqlNow =
  /\b(now|sysdate|getdate|curdate|current_timestamp|localtimestamp|current_date|today)\b\s*(\(|\b)/i;

/** A range selector with a fixed duration, such as `[24h]`. */
const fixedWindow = /\[\s*\d+(ms|s|m|h|d|w|y)\s*\]/;

/**
 * Why a SQL query names a fixed time, if it does.
 *
 * @param sql - The query's text.
 * @returns What to write instead, if anything.
 */
function sqlFixedTime(sql: string): string | undefined {
  if (sqlDate.test(sql))
    return 'the query compares with a fixed date: filter with :__from and :__to instead';
  if (sqlNow.test(sql))
    return 'the query reads the current time: filter with :__from and :__to instead';
  return undefined;
}

/**
 * Why an instant query names a fixed window, if it does.
 *
 * @param expr - The PromQL or LogQL expression.
 * @returns What to write instead, if anything.
 */
function instantFixedTime(expr: string): string | undefined {
  return fixedWindow.test(expr)
    ? 'the instant query covers a fixed window: use [$__range] for the dashboard’s range'
    : undefined;
}

/**
 * Why a query names a fixed time, if it does.
 *
 * @param query - The query.
 * @returns What to write instead, or `undefined` when the query follows the time range.
 */
export function fixedTimeOf(query: PanelQuery): string | undefined {
  if (query.language === 'sql') return sqlFixedTime(query.sql);
  if (query.language !== 'promql' && query.language !== 'logql') return undefined;
  return query.instant ? instantFixedTime(query.expr) : undefined;
}

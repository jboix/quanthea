/**
 * The SQL ratio builder: the share of the rows matching some conditions among the rows matching
 * others, such as failed orders over all orders, over time or over the range. The counts are
 * `CASE` sums and the division guards against zero with `nullif`, which every dialect has.
 */
import type { PanelQuery } from '@quanthea/shared';
import type { BuiltData } from './built.ts';
import type { Filter } from './fields.ts';
import type { DataOf } from './request.ts';
import {
  durationText,
  type SqlWriter,
  sqlCondition,
  sqlName,
  sqlWhere,
  timeKeys,
} from './sql-writers.ts';
import { QueryError } from './text.ts';

/** A ratio request. */
type RatioRequest = DataOf<'sql-ratio'>;

/**
 * The count of the rows matching filters: a `CASE` sum, or every row.
 *
 * @param writer - The dialect's writer.
 * @param filters - The filters.
 * @returns Such as `sum(CASE WHEN "status" = 'failed' THEN 1 ELSE 0 END)`.
 */
function countOf(writer: SqlWriter, filters: readonly Filter[]): string {
  if (filters.length === 0) return 'count(*)';
  const condition = filters.map((filter) => sqlCondition(writer, filter)).join(' AND ');
  return `sum(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;
}

/**
 * The selected measures: the counts when asked, then the share, or one minus it.
 *
 * @param writer - The dialect's writer.
 * @param request - The request.
 * @returns The select list after the keys.
 */
function measures(writer: SqlWriter, request: RatioRequest): string {
  const part = countOf(writer, request.match);
  const whole = countOf(writer, request.of);
  const share = `1e0 * ${part} / nullif(${whole}, 0)`;
  const value = request.complement ? `1 - ${share}` : share;
  const counts = request.counts
    ? `${part} AS ${writer.alias('matching')}, ${whole} AS ${writer.alias('total')}, `
    : '';
  return `${counts}${value} AS ${writer.alias('value')}`;
}

/**
 * A SQL query, refId A.
 *
 * @param request - The request.
 * @param sql - The statement.
 * @returns The query.
 */
function sqlQuery(request: RatioRequest, sql: string): PanelQuery {
  return { refId: 'A', connector: request.connector, language: 'sql', sql };
}

/**
 * A ratio over time: columns `time`, `series` when split, the counts when asked, and `value`.
 *
 * @param request - The request.
 * @param writer - The dialect's writer.
 * @param time - The timestamp column.
 * @returns The query and its output.
 */
function overTime(request: RatioRequest, writer: SqlWriter, time: string): BuiltData {
  const bucket = writer.bucket(sqlName(writer, time), durationText(request.bucket));
  const keys = timeKeys(writer, bucket, request.by);
  const from = sqlName(writer, request.table);
  const sql = `SELECT ${keys.select}, ${measures(writer, request)} FROM ${from}${sqlWhere(writer, time, request.filters)} ${keys.group} ORDER BY 1`;
  const counts = request.counts ? ['matching', 'total'] : [];
  return {
    queries: [sqlQuery(request, sql)],
    output: {
      shape: 'long',
      columns: ['time', ...(request.by ? ['series'] : []), ...counts, 'value'],
      chart: 'trend.line',
      unit: 'percent',
    },
  };
}

/**
 * A ratio over the range: per value of `by`, the most matching first, or one value.
 *
 * @param request - The request.
 * @param writer - The dialect's writer.
 * @returns The query and its output.
 */
function overRange(request: RatioRequest, writer: SqlWriter): BuiltData {
  const where = sqlWhere(writer, request.time, request.filters);
  const from = sqlName(writer, request.table);
  const by = request.by;
  const key = by ? `${writer.text(sqlName(writer, by))} AS ${sqlName(writer, by)}, ` : '';
  const group = by ? writer.groupBy([{ position: 1, expression: sqlName(writer, by) }]) : '';
  const tail = by
    ? ` ${group} ORDER BY ${countOf(writer, request.match)} DESC${writer.limit(request.limit)}`
    : '';
  const sql = `SELECT ${key}${measures(writer, request)} FROM ${from}${where}${tail}`;
  const counts = request.counts ? ['matching', 'total'] : [];
  return {
    queries: [sqlQuery(request, sql)],
    output: {
      shape: by ? 'long' : 'single',
      columns: [...(by ? [by] : []), ...counts, 'value'],
      chart: by ? 'comparison.bar' : 'kpi.stat',
      unit: 'percent',
    },
  };
}

/**
 * The share of the rows matching `match` among those matching `of`.
 *
 * @param request - The request.
 * @param writer - The dialect's writer.
 * @returns The query and its output.
 * @throws {QueryError} For a ratio over time without a time column.
 */
export function sqlRatioData(request: RatioRequest, writer: SqlWriter): BuiltData {
  if (request.over === 'range') return overRange(request, writer);
  if (!request.time) throw new QueryError('A ratio over time needs a time column.');
  return overTime(request, writer, request.time);
}

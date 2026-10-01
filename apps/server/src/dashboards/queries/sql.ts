/**
 * The SQL builders: a measure over time, a measure by category, one number, and the latest rows.
 * Names are quoted, literals escaped and variables bound; the time range is always bound.
 */
import type { PanelQuery } from '@querent/shared';
import type { BuildContext, BuiltData } from './built.ts';
import type { Filter } from './fields.ts';
import type { DataOf } from './request.ts';
import {
  durationText,
  type SqlWriter,
  sqlName,
  sqlWhere,
  sqlWriterFor,
  timeKeys,
} from './sql-writers.ts';
import { QueryError } from './text.ts';

/** A measure, as the requests carry it. */
type Measure = DataOf<'sql-stat'>['measure'];

/**
 * The SQL expression of a measure.
 *
 * @param writer - The dialect's writer.
 * @param measure - The measure.
 * @returns Such as `count(*)` or `sum("amount")`.
 * @throws {QueryError} When a measure other than count names no column.
 */
function measureSql(writer: SqlWriter, measure: Measure): string {
  if (measure.fn === 'count')
    return measure.column ? `count(${sqlName(writer, measure.column)})` : 'count(*)';
  if (!measure.column) throw new QueryError(`${measure.fn} needs a column.`);
  const column = sqlName(writer, measure.column);
  return measure.fn === 'count_distinct' ? `count(DISTINCT ${column})` : `${measure.fn}(${column})`;
}

/**
 * A SQL query, refId A.
 *
 * @param connector - The connector.
 * @param sql - The statement.
 * @returns The query.
 */
function sqlQuery(connector: string, sql: string): PanelQuery {
  return { refId: 'A', connector, language: 'sql', sql };
}

/**
 * A measure over time, in buckets, split by a column when asked: columns `time`, `series` when
 * split, and `value`.
 *
 * @param request - The request.
 * @param writer - The dialect's writer.
 * @returns The query and its output.
 */
export function seriesData(request: DataOf<'sql-series'>, writer: SqlWriter): BuiltData {
  const bucket = writer.bucket(sqlName(writer, request.time), durationText(request.bucket));
  const keys = timeKeys(writer, bucket, request.by);
  const where = sqlWhere(writer, request.time, request.filters);
  const value = `${measureSql(writer, request.measure)} AS ${writer.alias('value')}`;
  const sql = `SELECT ${keys.select}, ${value} FROM ${sqlName(writer, request.table)}${where} ${keys.group} ORDER BY 1`;
  const columns = request.by === undefined ? ['time', 'value'] : ['time', 'series', 'value'];
  return {
    queries: [sqlQuery(request.connector, sql)],
    output: { shape: 'long', columns, chart: 'trend.line' },
  };
}

/**
 * A measure by the values of a column, largest first: columns the `by` column and `value`.
 *
 * @param request - The request.
 * @param writer - The dialect's writer.
 * @returns The query and its output.
 */
export function breakdownData(request: DataOf<'sql-breakdown'>, writer: SqlWriter): BuiltData {
  const where = sqlWhere(writer, request.time, request.filters);
  const by = sqlName(writer, request.by);
  const value = `${measureSql(writer, request.measure)} AS ${writer.alias('value')}`;
  const group = writer.groupBy([{ position: 1, expression: by }]);
  const sql = `SELECT ${writer.text(by)} AS ${by}, ${value} FROM ${sqlName(writer, request.table)}${where} ${group} ORDER BY 2 DESC${writer.limit(request.limit)}`;
  return {
    queries: [sqlQuery(request.connector, sql)],
    output: { shape: 'long', columns: [request.by, 'value'], chart: 'comparison.bar' },
  };
}

/**
 * One number over the time range: column `value`.
 *
 * @param request - The request.
 * @param writer - The dialect's writer.
 * @returns The query and its output.
 */
export function statData(request: DataOf<'sql-stat'>, writer: SqlWriter): BuiltData {
  const where = sqlWhere(writer, request.time, request.filters);
  const sql = `SELECT ${measureSql(writer, request.measure)} AS ${writer.alias('value')} FROM ${sqlName(writer, request.table)}${where}`;
  return {
    queries: [sqlQuery(request.connector, sql)],
    output: { shape: 'single', columns: ['value'], chart: 'kpi.stat' },
  };
}

/**
 * The latest rows, newest first when there is a time column.
 *
 * @param request - The request.
 * @param writer - The dialect's writer.
 * @returns The query and its output.
 */
export function rowsData(request: DataOf<'sql-rows'>, writer: SqlWriter): BuiltData {
  const columns = request.columns.map((column) => sqlName(writer, column)).join(', ');
  const where = sqlWhere(writer, request.time, request.filters);
  const order = request.time === undefined ? '' : ` ORDER BY ${sqlName(writer, request.time)} DESC`;
  const sql = `SELECT ${columns} FROM ${sqlName(writer, request.table)}${where}${order}${writer.limit(request.limit)}`;
  return {
    queries: [sqlQuery(request.connector, sql)],
    output: { shape: 'rows', columns: request.columns, chart: 'table.rows' },
  };
}

/** Deploy markers: events from a table, drawn on every time chart. */
export interface MarkersRequest {
  /** The label, such as `deploy`. */
  readonly label: string;
  /** The connector. */
  readonly connector: string;
  /** The table. */
  readonly table: string;
  /** The time column. */
  readonly time: string;
  /** The text column. */
  readonly text: string;
  /** Filters on the rows. */
  readonly filters: readonly Filter[];
}

/**
 * The annotation of deploy markers: each row's time and text.
 *
 * @param request - The markers request.
 * @param context - The build context, for the connector's dialect.
 * @returns The annotation's query.
 */
export function markersQuery(request: MarkersRequest, context: BuildContext): PanelQuery {
  const writer = sqlWriterFor(context.dialectOf?.(request.connector));
  const where = sqlWhere(writer, request.time, request.filters);
  const text = writer.text(sqlName(writer, request.text));
  const sql = `SELECT ${sqlName(writer, request.time)} AS ${writer.alias('time')}, ${text} AS ${writer.alias('text')} FROM ${sqlName(writer, request.table)}${where} ORDER BY 1`;
  return { refId: 'M', connector: request.connector, language: 'sql', sql };
}

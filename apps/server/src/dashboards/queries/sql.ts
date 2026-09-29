/**
 * The SQL builders: a measure over time, a measure by category, one number, and the latest rows.
 * Names are quoted, literals escaped and variables bound; the time range is always bound.
 */
import type { PanelQuery } from '@querent/shared';
import type { BuiltData } from './built.ts';
import type { DataOf, Filter } from './request.ts';
import { QueryError, sqlInterval, sqlName, sqlWhere } from './text.ts';

/** A measure, as the requests carry it. */
type Measure = DataOf<'sql-stat'>['measure'];

/**
 * The SQL expression of a measure.
 *
 * @param measure - The measure.
 * @returns Such as `count(*)` or `sum("amount")`.
 * @throws {QueryError} When a measure other than count names no column.
 */
function measureSql(measure: Measure): string {
  if (measure.fn === 'count')
    return measure.column ? `count(${sqlName(measure.column)})` : 'count(*)';
  if (!measure.column) throw new QueryError(`${measure.fn} needs a column.`);
  if (measure.fn === 'count_distinct') return `count(DISTINCT ${sqlName(measure.column)})`;
  return `${measure.fn}(${sqlName(measure.column)})`;
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
 * @returns The query and its output.
 */
export function seriesData(request: DataOf<'sql-series'>): BuiltData {
  const bucket = `date_bin(${sqlInterval(request.bucket)}, ${sqlName(request.time)}, :__from)`;
  const split = request.by === undefined ? '' : `, ${sqlName(request.by)}::text AS series`;
  const where = sqlWhere(request.time, request.filters);
  const groups = request.by === undefined ? '1' : '1, 2';
  const sql = `SELECT ${bucket} AS time${split}, ${measureSql(request.measure)} AS value FROM ${sqlName(request.table)}${where} GROUP BY ${groups} ORDER BY 1`;
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
 * @returns The query and its output.
 */
export function breakdownData(request: DataOf<'sql-breakdown'>): BuiltData {
  const where = sqlWhere(request.time, request.filters);
  const by = sqlName(request.by);
  const sql = `SELECT ${by}::text AS ${by}, ${measureSql(request.measure)} AS value FROM ${sqlName(request.table)}${where} GROUP BY 1 ORDER BY 2 DESC LIMIT ${request.limit}`;
  return {
    queries: [sqlQuery(request.connector, sql)],
    output: { shape: 'long', columns: [request.by, 'value'], chart: 'comparison.bar' },
  };
}

/**
 * One number over the time range: column `value`.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function statData(request: DataOf<'sql-stat'>): BuiltData {
  const where = sqlWhere(request.time, request.filters);
  const sql = `SELECT ${measureSql(request.measure)} AS value FROM ${sqlName(request.table)}${where}`;
  return {
    queries: [sqlQuery(request.connector, sql)],
    output: { shape: 'single', columns: ['value'], chart: 'kpi.stat' },
  };
}

/**
 * The latest rows, newest first when there is a time column.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function rowsData(request: DataOf<'sql-rows'>): BuiltData {
  const columns = request.columns.map(sqlName).join(', ');
  const where = sqlWhere(request.time, request.filters);
  const order = request.time === undefined ? '' : ` ORDER BY ${sqlName(request.time)} DESC`;
  const sql = `SELECT ${columns} FROM ${sqlName(request.table)}${where}${order} LIMIT ${request.limit}`;
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
 * @returns The annotation's query.
 */
export function markersQuery(request: MarkersRequest): PanelQuery {
  const where = sqlWhere(request.time, request.filters);
  const sql = `SELECT ${sqlName(request.time)} AS time, ${sqlName(request.text)}::text AS text FROM ${sqlName(request.table)}${where} ORDER BY 1`;
  return { refId: 'M', connector: request.connector, language: 'sql', sql };
}

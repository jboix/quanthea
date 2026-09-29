/**
 * The SQL recipes: a measure over time, a measure by category, one number, and the latest rows.
 * Names are quoted, literals escaped and variables bound; the time range is always bound.
 */
import type { PanelQuery } from '@querent/shared';
import type { PanelDraft } from './draft.ts';
import type { MarkersRequest, RecipeOf } from './request.ts';
import { RecipeError, sqlInterval, sqlName, sqlWhere } from './text.ts';
import { categoryChart, statView, tableView, timeChart } from './views.ts';

/** A measure, as the requests carry it. */
type Measure = RecipeOf<'sql-stat'>['measure'];

/**
 * The SQL expression of a measure.
 *
 * @param measure - The measure.
 * @returns Such as `count(*)` or `sum("amount")`.
 * @throws {RecipeError} When a measure other than count names no column.
 */
function measureSql(measure: Measure): string {
  if (measure.fn === 'count')
    return measure.column ? `count(${sqlName(measure.column)})` : 'count(*)';
  if (!measure.column) throw new RecipeError(`${measure.fn} needs a column.`);
  if (measure.fn === 'count_distinct') return `count(DISTINCT ${sqlName(measure.column)})`;
  return `${measure.fn}(${sqlName(measure.column)})`;
}

/**
 * A SQL query of a panel.
 *
 * @param connector - The connector.
 * @param sql - The statement.
 * @returns The query, refId A.
 */
function sqlQuery(connector: string, sql: string): PanelQuery {
  return { refId: 'A', connector, language: 'sql', sql };
}

/**
 * The title, and the description when there is one.
 *
 * @param request - The request.
 * @returns The parts.
 */
function draftBase(request: { title: string; description?: string | undefined }) {
  return {
    title: request.title,
    ...(request.description === undefined ? {} : { description: request.description }),
  };
}

/**
 * A measure over time, in buckets, split by a column when asked.
 *
 * @param request - The request.
 * @returns The draft.
 */
export function seriesDraft(request: RecipeOf<'sql-series'>): PanelDraft {
  const bucket = `date_bin(${sqlInterval(request.bucket)}, ${sqlName(request.time)}, :__from)`;
  const split = request.by === undefined ? '' : `, ${sqlName(request.by)}::text AS series`;
  const where = sqlWhere(request.time, request.filters);
  const groups = request.by === undefined ? '1' : '1, 2';
  const sql = `SELECT ${bucket} AS time${split}, ${measureSql(request.measure)} AS value FROM ${sqlName(request.table)}${where} GROUP BY ${groups} ORDER BY 1`;
  const pivot = request.by === undefined ? undefined : 'series';
  return {
    ...draftBase(request),
    queries: [sqlQuery(request.connector, sql)],
    view: timeChart(['A'], request.show, request.unit, pivot),
    shape: 'time',
    width: request.width,
  };
}

/**
 * A measure by the values of a column, largest first.
 *
 * @param request - The request.
 * @returns The draft.
 */
export function breakdownDraft(request: RecipeOf<'sql-breakdown'>): PanelDraft {
  const where = sqlWhere(request.time, request.filters);
  const by = sqlName(request.by);
  const sql = `SELECT ${by}::text AS ${by}, ${measureSql(request.measure)} AS value FROM ${sqlName(request.table)}${where} GROUP BY 1 ORDER BY 2 DESC LIMIT ${request.limit}`;
  const table = request.show === 'table';
  return {
    ...draftBase(request),
    queries: [sqlQuery(request.connector, sql)],
    view: table
      ? tableView([request.by, 'value'], request.unit)
      : categoryChart('A', request.show === 'pie' ? 'pie' : 'bar'),
    shape: table ? 'table' : 'chart',
    width: request.width,
  };
}

/**
 * One number over the time range.
 *
 * @param request - The request.
 * @returns The draft.
 */
export function statDraft(request: RecipeOf<'sql-stat'>): PanelDraft {
  const where = sqlWhere(request.time, request.filters);
  const sql = `SELECT ${measureSql(request.measure)} AS value FROM ${sqlName(request.table)}${where}`;
  return {
    ...draftBase(request),
    queries: [sqlQuery(request.connector, sql)],
    view: statView(request.unit, 'last', 'value'),
    shape: 'stat',
    width: request.width,
  };
}

/**
 * The latest rows, newest first when there is a time column.
 *
 * @param request - The request.
 * @returns The draft.
 */
export function rowsDraft(request: RecipeOf<'sql-rows'>): PanelDraft {
  const columns = request.columns.map(sqlName).join(', ');
  const where = sqlWhere(request.time, request.filters);
  const order = request.time === undefined ? '' : ` ORDER BY ${sqlName(request.time)} DESC`;
  const sql = `SELECT ${columns} FROM ${sqlName(request.table)}${where}${order} LIMIT ${request.limit}`;
  return {
    ...draftBase(request),
    queries: [sqlQuery(request.connector, sql)],
    view: tableView(request.columns),
    shape: 'table',
    width: request.width,
  };
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

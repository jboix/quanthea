/**
 * The search table builder: named columns by the values of one to three fields, or by named
 * groups of documents. Each column is a count, a metric or a percentile under its own filters, or
 * the ratio of two other columns through the kit's ratio script. One field groups with `terms`,
 * several with `multi_terms`, whose answer gives a column per field; named groups with `filters`.
 */
import { refusedAnywhere } from '../../query/search-binder.ts';
import type { BuiltData } from './built.ts';
import type { DataOf } from './request.ts';
import { aggsBody, searchQuery } from './search.ts';
import { checkSplit, groupColumn, metricOf, namedGroupsOf, ratioScriptOf } from './search-body.ts';
import { boolQuery } from './search-filters.ts';
import type { SearchColumn } from './search-request.ts';
import { QueryError } from './text.ts';

/** A JSON object of a search body. */
type Json = Record<string, unknown>;

/** A column name: a letter, then letters, digits and underscores. */
const columnName = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A column that reads documents, not other columns. */
type Measured = SearchColumn & { readonly fn: Exclude<SearchColumn['fn'], 'ratio'> };

/**
 * Whether a column reads documents.
 *
 * @param column - The column.
 * @returns `true` for a count, a metric or a percentile.
 */
function measured(column: SearchColumn): column is Measured {
  return column.fn !== 'ratio';
}

/**
 * The name of the filter a measured column with filters sits under.
 *
 * @param column - The column.
 * @returns Its name, after the column's.
 */
function filterName(column: SearchColumn): string {
  return `${column.name}_filter`;
}

/**
 * The path from a group's bucket to a measured column's number, for a ratio or a sort.
 *
 * @param column - The column.
 * @returns The path, with `>` between aggregations.
 */
function pathOf(column: Measured): string {
  const metric = column.fn === 'percentile' ? `${column.name}.${column.percent}` : column.name;
  if (column.filters.length === 0) return metric;
  if (column.fn === 'count') return `${column.name}>_count`;
  return `${filterName(column)}>${metric}`;
}

/**
 * The metric aggregation of a measured column.
 *
 * @param column - The column.
 * @param time - The time field, which a count counts.
 * @returns The aggregation.
 * @throws {QueryError} When the column needs a field or a percent it lacks.
 */
function metricOfColumn(column: Measured, time: string): Json {
  if (column.fn !== 'percentile') return metricOf({ fn: column.fn, field: column.field }, time);
  if (column.percent === undefined) throw new QueryError(`${column.name} needs a percent.`);
  return metricOf({ fn: 'percentiles', field: column.field, percents: [column.percent] }, time);
}

/**
 * The aggregations of a measured column: its metric, under a filter when it has filters. A count
 * under filters is the filter's own count.
 *
 * @param column - The column.
 * @param time - The time field.
 * @returns The aggregations, by name.
 */
function measuredAggs(column: Measured, time: string): Json {
  if (column.filters.length === 0) return { [column.name]: metricOfColumn(column, time) };
  const filter = boolQuery(column.filters);
  if (column.fn === 'count') return { [column.name]: { filter } };
  const aggs = { [column.name]: metricOfColumn(column, time) };
  return { [filterName(column)]: { filter, aggs } };
}

/**
 * The `bucket_script` of a ratio column.
 *
 * @param column - The ratio column.
 * @param byName - The measured columns, by name.
 * @returns The aggregation.
 * @throws {QueryError} When `part` or `whole` names no count or metric column.
 */
function ratioAggOf(column: SearchColumn, byName: ReadonlyMap<string, Measured>): Json {
  const part = byName.get(column.part ?? '');
  const whole = column.whole === undefined ? undefined : byName.get(column.whole);
  if (!part || (column.whole !== undefined && !whole))
    throw new QueryError(
      `${column.name}: "part" and "whole" name count or metric columns of this table, not ratios or percentiles.`,
    );
  const paths = { part: pathOf(part), whole: whole ? pathOf(whole) : '_count' };
  return { bucket_script: { buckets_path: paths, script: ratioScriptOf(column.complement) } };
}

/**
 * Checks the names of a table's columns: plain, unique, not taken by another column's filter,
 * and not a key the search check refuses.
 *
 * @param columns - The columns.
 * @param by - The fields grouped by, which name columns too.
 * @throws {QueryError} For a name that does not fit.
 */
function checkNames(columns: readonly SearchColumn[], by: readonly string[]): void {
  const taken = new Set(by);
  for (const name of columns.flatMap(aggregationNames)) {
    if (!columnName.test(name) || refusedAnywhere(name))
      throw new QueryError(`"${name}" cannot name a column: use letters, digits and _.`);
    if (taken.has(name)) throw new QueryError(`Two columns are named "${name}".`);
    taken.add(name);
  }
}

/**
 * The names of the aggregations a column makes: its own, and its filter's when it has one.
 *
 * @param column - The column.
 * @returns The names.
 */
function aggregationNames(column: SearchColumn): string[] {
  const filtered = measured(column) && column.fn !== 'count' && column.filters.length > 0;
  return filtered ? [column.name, filterName(column)] : [column.name];
}

/**
 * The aggregations of every column, in the order asked: a ratio may come before the columns it
 * reads, since the search finds them by name.
 *
 * @param columns - The columns.
 * @param time - The time field.
 * @returns The aggregations, by name.
 */
function columnAggs(columns: readonly SearchColumn[], time: string): Json {
  // A ratio reads counts and metrics; a percentile has no single number for it.
  const readable = columns.filter(measured).filter((column) => column.fn !== 'percentile');
  const byName = new Map(readable.map((column) => [column.name, column]));
  const aggs: Json = {};
  for (const column of columns) {
    if (measured(column)) Object.assign(aggs, measuredAggs(column, time));
    else aggs[column.name] = ratioAggOf(column, byName);
  }
  return aggs;
}

/**
 * How the groups are ordered: by a count or metric through the grouping's own `order`, which keeps
 * the right groups; by a ratio, or among named groups, through a `bucket_sort` over the groups
 * kept.
 *
 * @param request - The request.
 * @returns The grouping's order, and the sort to add under it, if any.
 * @throws {QueryError} When `sort` names no column.
 */
function orderOf(request: DataOf<'search-table'>): { order: Json; sort?: Json } {
  const direction = request.ascending ? 'asc' : 'desc';
  const name = request.sort ?? request.columns[0]?.name;
  const column = request.columns.find((candidate) => candidate.name === name);
  if (!column) throw new QueryError(`"sort" names no column: ${name}.`);
  const path = measured(column) ? pathOf(column) : column.name;
  if (measured(column) && !request.groups) return { order: { [path]: direction } };
  const sort = { bucket_sort: { sort: [{ [path]: { order: direction } }] } };
  return { order: { _count: 'desc' }, sort };
}

/**
 * The grouping of a table: its named groups, `terms` on one field, named after it, or
 * `multi_terms` on several.
 *
 * @param request - The request.
 * @param order - How the groups are ordered.
 * @returns The grouping's name and its aggregation, without its sub-aggregations.
 */
function groupingOf(request: DataOf<'search-table'>, order: Json): [string, Json] {
  const { by = [], groups, limit } = request;
  if (groups) return [groupColumn, namedGroupsOf(groups)];
  const meta = request.other ? { meta: { other: otherColumnsOf(request.columns) } } : {};
  if (by.length === 1)
    return [by[0] ?? '', { terms: { field: by[0], size: limit, order }, ...meta }];
  const terms = by.map((field) => ({ field }));
  return ['groups', { multi_terms: { terms, size: limit, order }, ...meta }];
}

/**
 * The columns an "Other" row fills: the counts with no filters of their own, which count every
 * document of a group.
 *
 * @param columns - The columns.
 * @returns Their names.
 * @throws {QueryError} When the table has no such column.
 */
function otherColumnsOf(columns: readonly SearchColumn[]): string[] {
  const counts = columns.filter((column) => column.fn === 'count' && column.filters.length === 0);
  if (counts.length === 0)
    throw new QueryError('"other" needs a count column with no filters, which it fills.');
  return counts.map((column) => column.name);
}

/**
 * A table of named columns by the values of one to three fields, or by named groups: columns the
 * `by` fields (`group` for groups), then each column in order (a percentile column is named
 * `<name> p<percent>`). With `other`, a last row "Other" holds the documents outside the groups
 * in the plain count columns.
 *
 * @param request - The request.
 * @returns The query and its output.
 * @throws {QueryError} For a split or a column that does not fit.
 */
export function searchTableData(request: DataOf<'search-table'>): BuiltData {
  checkSplit(request.by, request.groups, request.other);
  const keys = request.by ?? [groupColumn];
  checkNames(request.columns, keys);
  const { order, sort } = orderOf(request);
  const [name, grouping] = groupingOf(request, order);
  const aggs = { ...columnAggs(request.columns, request.time), ...(sort ? { _sort: sort } : {}) };
  const columns = [
    ...keys,
    ...request.columns.map((column) =>
      column.fn === 'percentile' ? `${column.name} p${column.percent}` : column.name,
    ),
  ];
  return {
    queries: [searchQuery(request, aggsBody(request, { [name]: { ...grouping, aggs } }))],
    output: { shape: 'long', columns, chart: 'table.rows' },
  };
}

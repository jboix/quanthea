/**
 * Preparations for charts on axes and for items: an x and value columns, pivoted from a long
 * table when a series column splits them; shares of each row; ranked categories; groups of points;
 * and categories as items, the rest summed as "Other".
 */
import {
  type Cell,
  columnIndex,
  columnValues,
  type Dataset,
  longToWide,
  sortRows,
} from '@quanthea/shared';
import { allColumns, oneColumn, seriesColumn, xColumn, yColumns } from '../roles.ts';
import type { Prepared, PrepareInput } from './types.ts';

/**
 * The data as it is, sorted by the x when it is a time.
 *
 * @param input - The option, datasets and roles.
 * @param x - The x column.
 * @param y - The value columns.
 * @returns The prepared data.
 */
function unpivoted(input: PrepareInput, x: string | undefined, y: string[]): Prepared {
  const [dataset, ...rest] = input.datasets;
  const byTime = dataset?.dimensions.find((column) => column.name === x)?.type === 'time';
  const data = dataset && x && byTime ? sortRows(dataset, x, 'asc') : dataset;
  const roles = { ...input.roles, ...(x ? { x } : {}), y };
  return { datasets: data ? [data, ...rest] : [], option: input.option, roles };
}

/**
 * The x and value columns, pivoted when a series column splits a long table.
 *
 * @param input - The option, datasets and roles.
 * @returns The wide dataset, and the roles x and y naming its columns.
 */
export function cartesian(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  if (!dataset) return { datasets: [], option: input.option, roles: input.roles };
  const x = xColumn(input.roles, dataset);
  const series = seriesColumn(input.roles, dataset);
  const values = yColumns(input.roles, dataset, x);
  const [value] = values;
  if (!x || !series || !value || values.length !== 1) return unpivoted(input, x, values);
  const wide = longToWide(sortRows(dataset, x, 'asc'), { x, series, value });
  const y = wide.dimensions.slice(1).map((column) => column.name);
  const roles = { ...input.roles, x, y };
  return { datasets: [wide, ...input.datasets.slice(1)], option: input.option, roles };
}

/**
 * As {@link cartesian}, each row scaled so its values add up to 1.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared data.
 */
export function shares(input: PrepareInput): Prepared {
  const prepared = cartesian(input);
  const [dataset] = prepared.datasets;
  if (!dataset) return prepared;
  const indexes = allColumns(prepared.roles, 'y').map((name) => columnIndex(dataset, name));
  const source = dataset.source.map((row) => {
    const total = indexes.reduce((sum, index) => sum + Number(row[index] ?? 0), 0);
    return row.map((cell, index) =>
      indexes.includes(index) && total !== 0 ? Number(cell ?? 0) / total : cell,
    );
  });
  return { ...prepared, datasets: [{ ...dataset, source }, ...prepared.datasets.slice(1)] };
}

/**
 * As {@link cartesian}, categories sorted by their first value, largest first, cut to the limit.
 *
 * @param input - The option, datasets, roles and limit.
 * @returns The prepared data.
 */
export function ranked(input: PrepareInput): Prepared {
  const prepared = cartesian(input);
  const [dataset] = prepared.datasets;
  const first = allColumns(prepared.roles, 'y')[0];
  if (!dataset || !first) return prepared;
  const sorted = sortRows(dataset, first, 'desc');
  const cut = { ...sorted, source: sorted.source.slice(0, input.limit ?? 15) };
  return { ...prepared, datasets: [cut, ...prepared.datasets.slice(1)] };
}

/**
 * Rows split by a group column, one dataset each, for one series per group.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared data, with the group names.
 */
export function groups(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const group = oneColumn(input.roles, 'group');
  if (!dataset || !group)
    return { datasets: input.datasets, option: input.option, roles: input.roles };
  const index = columnIndex(dataset, group);
  const names = [...new Set(columnValues(dataset, group).map((cell) => String(cell ?? '')))];
  const datasets = names.map((name) => ({
    ...dataset,
    source: dataset.source.filter((row) => String(row[index] ?? '') === name),
  }));
  return { datasets, option: input.option, roles: input.roles, groups: names };
}

/**
 * Categories as items, largest first; past the limit, the rest are summed as "Other".
 *
 * @param input - The option, datasets, roles and limit.
 * @returns The prepared data: the roles category and value naming its two columns.
 */
export function items(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  if (!dataset) return { datasets: [], option: input.option, roles: input.roles };
  const category = oneColumn(input.roles, 'category') ?? xColumn(input.roles, dataset) ?? '';
  const value =
    oneColumn(input.roles, 'value') ?? yColumns(input.roles, dataset, category)[0] ?? '';
  const [at, valueAt] = [columnIndex(dataset, category), columnIndex(dataset, value)];
  const rows: Cell[][] = sortRows(dataset, value, 'desc').source.map((row) => [
    row[at] ?? null,
    row[valueAt] ?? null,
  ]);
  const limit = input.limit ?? rows.length;
  const kept = rows.length > limit ? rows.slice(0, limit - 1) : rows;
  const rest = rows.slice(kept.length).reduce((sum, row) => sum + Number(row[1] ?? 0), 0);
  const source = rows.length > limit ? [...kept, ['Other', rest]] : kept;
  const dimensions = [dataset.dimensions[at], dataset.dimensions[valueAt]].filter(
    (column) => column !== undefined,
  );
  const prepared: Dataset = { dimensions, source };
  return { datasets: [prepared], option: input.option, roles: { ...input.roles, category, value } };
}

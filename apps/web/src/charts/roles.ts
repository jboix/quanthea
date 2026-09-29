/**
 * The columns of a chart's roles as the adapter reads them, with the choices views written before
 * chart recipes leave to the adapter: the x is the first time or text column, and the values are
 * the number columns.
 */
import type { Dataset, RoleColumns } from '@querent/shared';

/**
 * The first column of a role.
 *
 * @param roles - The roles.
 * @param name - The role.
 * @returns The column, if the role has one.
 */
export function oneColumn(roles: RoleColumns, name: string): string | undefined {
  const value = roles[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Every column of a role.
 *
 * @param roles - The roles.
 * @param name - The role.
 * @returns The columns, empty when the role has none.
 */
export function allColumns(roles: RoleColumns, name: string): string[] {
  const value = roles[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The x a view names, or the first time column, or the first text column.
 *
 * @param roles - The roles.
 * @param dataset - The data.
 * @returns The column, if any fits.
 */
export function xColumn(roles: RoleColumns, dataset: Dataset): string | undefined {
  const named = oneColumn(roles, 'x');
  if (named) return named;
  const byType = (type: string) => dataset.dimensions.find((column) => column.type === type)?.name;
  return byType('time') ?? byType('string') ?? dataset.dimensions[0]?.name;
}

/**
 * The column splitting a long table into series: the one the view names, or for a view that names
 * no roles, the `series` column that results with one frame per series have.
 *
 * @param roles - The roles.
 * @param dataset - The data.
 * @returns The column, if any.
 */
export function seriesColumn(roles: RoleColumns, dataset: Dataset): string | undefined {
  const named = oneColumn(roles, 'series');
  if (named || Object.keys(roles).length > 0) return named;
  return dataset.dimensions.find((column) => column.name === 'series' && column.type === 'string')
    ?.name;
}

/**
 * The value columns a view names, or every number column but the x.
 *
 * @param roles - The roles.
 * @param dataset - The data.
 * @param x - The x column.
 * @returns The columns.
 */
export function yColumns(roles: RoleColumns, dataset: Dataset, x: string | undefined): string[] {
  const named = allColumns(roles, 'y');
  if (named.length > 0) return named;
  return dataset.dimensions
    .filter((column) => column.type === 'number' && column.name !== x)
    .map((column) => column.name);
}

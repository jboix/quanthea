/**
 * The `pivot` operation: a row per value of one column, a column per value of another, and in
 * each cell the sum of a number column, zero where there is none. The new columns are named by
 * data, so they are values: the gate hides those names where its level hides values.
 */
import type { Operation } from '../spec/operations.ts';
import type { Cell, Dimension } from './contract.ts';
import { naturalCompare } from './natural.ts';
import {
  type ColumnOrigin,
  columnOf,
  type Derived,
  numberColumn,
  OperationError,
  sourcesOf,
} from './operation-table.ts';

/** The most columns a pivot makes, beside the rows column. */
export const maxPivotColumns = 50;

/** The name of the column for rows that have no value in the `columns` column. */
const noValue = '(none)';

/** A pivot step. */
type Pivot = Extract<Operation, { op: 'pivot' }>;

/**
 * The names of a pivot's new columns: the values of its `columns` column, in natural order.
 *
 * @param derived - The table.
 * @param step - The step.
 * @param at - The place of the `columns` column.
 * @returns The names.
 * @throws {OperationError} Past {@link maxPivotColumns}, or for a value named as the rows column.
 */
function pivotNames(derived: Derived, step: Pivot, at: number): string[] {
  const names = [...new Set(derived.table.source.map((row) => nameOf(row[at] ?? null)))];
  if (names.length > maxPivotColumns)
    throw new OperationError(
      `"${step.columns}" has ${names.length} values, more than the ${maxPivotColumns} columns a pivot makes: ask for fewer`,
    );
  if (names.includes(step.rows))
    throw new OperationError(`a value of "${step.columns}" is also the name of "${step.rows}"`);
  return names.sort(naturalCompare);
}

/**
 * A cell as a column name.
 *
 * @param cell - The cell.
 * @returns Its text, or {@link noValue}.
 */
function nameOf(cell: Cell): string {
  return cell === null ? noValue : String(cell);
}

/**
 * Pivots the table: a row per value of `rows`, in the order they first come, and a column per
 * value of `columns`, holding the sum of `value`.
 *
 * @param derived - The table.
 * @param step - The step.
 * @returns The pivoted table.
 * @throws {OperationError} For a missing column, a value column of text, or too many columns.
 */
export function pivot(derived: Derived, step: Pivot): Derived {
  const rowAt = columnOf(derived, step.rows);
  const columnAt = columnOf(derived, step.columns);
  const valueAt = numberColumn(derived, step.value);
  const names = pivotNames(derived, step, columnAt);
  const sums = new Map<string, { key: Cell; cells: number[] }>();
  for (const row of derived.table.source) {
    const key = row[rowAt] ?? null;
    const entry = sums.get(JSON.stringify(key)) ?? { key, cells: names.map(() => 0) };
    const place = names.indexOf(nameOf(row[columnAt] ?? null));
    const value = row[valueAt];
    if (typeof value === 'number') entry.cells[place] = (entry.cells[place] ?? 0) + value;
    sums.set(JSON.stringify(key), entry);
  }
  const rowsColumn = derived.table.dimensions[rowAt] as Dimension;
  const dimensions = [rowsColumn, ...names.map((name) => ({ name, type: 'number' as const }))];
  const source = [...sums.values()].map(({ key, cells }) => [key, ...cells]);
  return { table: { dimensions, source }, origins: pivotOrigins(derived, step, names) };
}

/**
 * The origins of a pivot's columns: the rows column as it was, each new column from the queries
 * of `columns` and `value`, named by data.
 *
 * @param derived - The table.
 * @param step - The step.
 * @param names - The new columns.
 * @returns The origins, by column.
 */
function pivotOrigins(
  derived: Derived,
  step: Pivot,
  names: readonly string[],
): Map<string, ColumnOrigin> {
  const from = sourcesOf(derived, [step.columns, step.value]);
  const rows = derived.origins.get(step.rows) ?? { column: step.rows, from };
  return new Map([
    [step.rows, rows],
    ...names.map((name) => [name, { column: name, from, nameFromData: true }] as const),
  ]);
}

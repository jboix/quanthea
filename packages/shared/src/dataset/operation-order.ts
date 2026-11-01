/**
 * The `concat` and `sort` operations: a text column joined from others, and the rows in natural
 * order.
 */
import type { Operation } from '../spec/operations.ts';
import type { Cell } from './contract.ts';
import { naturalCompare } from './natural.ts';
import { columnOf, type Derived, sourcesOf, withColumn } from './operation-table.ts';

/** A concat step. */
type Concat = Extract<Operation, { op: 'concat' }>;

/** A sort step. */
type Sort = Extract<Operation, { op: 'sort' }>;

/**
 * Adds a text column joined from others with a separator. A missing value is left out; a row
 * with none gives a missing value.
 *
 * @param derived - The table.
 * @param step - The step.
 * @returns The table with the new column last, or in place of a column of the same name.
 * @throws {OperationError} When a column is missing.
 */
export function concat(derived: Derived, step: Concat): Derived {
  const indexes = step.columns.map((name) => columnOf(derived, name));
  const textOf = (row: readonly Cell[]): Cell => {
    const parts = indexes.map((index) => row[index] ?? null).filter((cell) => cell !== null);
    return parts.length === 0 ? null : parts.map(String).join(step.separator);
  };
  const values = derived.table.source.map(textOf);
  const from = sourcesOf(derived, step.columns);
  return withColumn(derived, { name: step.name, type: 'string' }, values, from);
}

/**
 * Orders two cells: numbers and times by value, text and booleans in natural order, missing
 * values last whatever the direction.
 *
 * @param first - One cell.
 * @param second - The other.
 * @param sign - 1 for ascending, -1 for descending.
 * @returns Negative, zero or positive.
 */
function compareCells(first: Cell, second: Cell, sign: number): number {
  if (first === null || second === null)
    return (first === null ? 1 : 0) - (second === null ? 1 : 0);
  if (typeof first === 'number' && typeof second === 'number') return sign * (first - second);
  return sign * naturalCompare(String(first), String(second));
}

/**
 * Sorts the rows by a column, ascending unless `descending`. Rows that tie keep their order.
 *
 * @param derived - The table.
 * @param step - The step.
 * @returns The sorted table.
 * @throws {OperationError} When the column is missing.
 */
export function sort(derived: Derived, step: Sort): Derived {
  const at = columnOf(derived, step.by);
  const sign = step.descending ? -1 : 1;
  const source = [...derived.table.source].sort((a, b) =>
    compareCells(a[at] ?? null, b[at] ?? null, sign),
  );
  return { ...derived, table: { ...derived.table, source } };
}

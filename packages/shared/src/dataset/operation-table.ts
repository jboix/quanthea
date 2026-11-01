/**
 * The table the operations work on: a dataset, and where each of its columns comes from. The
 * origins let the gate show each connector's data at that connector's access level, and hide the
 * names of columns that come from data where values are hidden.
 */
import type { Cell, Dataset, Dimension } from './contract.ts';
import { columnIndex } from './reshape.ts';

/** Why a table operation could not run, in words that quote no data. */
export class OperationError extends Error {}

/** Where one column of a derived table comes from. */
export interface ColumnOrigin {
  /** The column. */
  readonly column: string;
  /** The refIds of the queries its values come from. */
  readonly from: readonly string[];
  /** Whether its name is a value of the data, as a pivot makes. */
  readonly nameFromData?: boolean | undefined;
}

/** A table during the operations: the dataset and the origin of each column, by name. */
export interface Derived {
  /** The table. */
  readonly table: Dataset;
  /** The origin of each column, by its name. */
  readonly origins: ReadonlyMap<string, ColumnOrigin>;
}

/**
 * A query's table as the start of the operations: every column from that query.
 *
 * @param refId - The query.
 * @param table - Its table.
 * @returns The derived table.
 */
export function derivedOf(refId: string, table: Dataset): Derived {
  const origins = table.dimensions.map(
    ({ name }) => [name, { column: name, from: [refId] }] as const,
  );
  return { table, origins: new Map(origins) };
}

/**
 * The column names of a table, for a message. Names that come from data are left out.
 *
 * @param derived - The table.
 * @returns Such as `columns: time, errors, sessions`.
 */
export function namesOf(derived: Derived): string {
  const names = derived.table.dimensions
    .map((column) => column.name)
    .filter((name) => !derived.origins.get(name)?.nameFromData);
  return `columns: ${names.join(', ')}`;
}

/**
 * The place of a column, for a step.
 *
 * @param derived - The table.
 * @param name - The column.
 * @returns Its index.
 * @throws {OperationError} When the table has no such column.
 */
export function columnOf(derived: Derived, name: string): number {
  const index = columnIndex(derived.table, name);
  if (index < 0) throw new OperationError(`no column "${name}" (${namesOf(derived)})`);
  return index;
}

/**
 * The place of a number column, for a step.
 *
 * @param derived - The table.
 * @param name - The column.
 * @returns Its index.
 * @throws {OperationError} When the table has no such column, or it does not hold numbers.
 */
export function numberColumn(derived: Derived, name: string): number {
  const index = columnOf(derived, name);
  if (derived.table.dimensions[index]?.type !== 'number')
    throw new OperationError(`the column "${name}" does not hold numbers`);
  return index;
}

/**
 * The queries a set of columns comes from.
 *
 * @param derived - The table.
 * @param names - The columns.
 * @returns Their refIds, each once.
 */
export function sourcesOf(derived: Derived, names: readonly string[]): string[] {
  return [...new Set(names.flatMap((name) => derived.origins.get(name)?.from ?? []))];
}

/**
 * A table with a column set: replaced where one has the name, added last otherwise.
 *
 * @param derived - The table.
 * @param column - The column.
 * @param values - Its values, one per row.
 * @param from - The queries its values come from.
 * @returns The new table.
 */
export function withColumn(
  derived: Derived,
  column: Dimension,
  values: readonly Cell[],
  from: readonly string[],
): Derived {
  const { table } = derived;
  const at = columnIndex(table, column.name);
  const origins = new Map(derived.origins).set(column.name, { column: column.name, from });
  if (at < 0)
    return {
      table: {
        dimensions: [...table.dimensions, column],
        source: table.source.map((row, index) => [...row, values[index] ?? null]),
      },
      origins,
    };
  const dimensions = table.dimensions.map((each, index) => (index === at ? column : each));
  const source = table.source.map((row, index) =>
    row.map((cell, place) => (place === at ? (values[index] ?? null) : cell)),
  );
  return { table: { dimensions, source }, origins };
}

/**
 * The `join` and `append` operations: the table of another query of the panel, its columns renamed
 * first, joined on key columns or added under the table's rows.
 */
import type { Operation } from '../spec/operations.ts';
import type { Cell, Dataset, Dimension } from './contract.ts';
import {
  type ColumnOrigin,
  columnOf,
  type Derived,
  derivedOf,
  OperationError,
} from './operation-table.ts';

/** The most rows a join or an append may make: the default row limit of a query. */
export const maxDerivedRows = 50_000;

/** A join step. */
type Join = Extract<Operation, { op: 'join' }>;

/** An append step. */
type Append = Extract<Operation, { op: 'append' }>;

/**
 * The table of another query, its columns renamed.
 *
 * @param tables - The tables of the panel's queries, by refId.
 * @param step - The step that reads it.
 * @returns The table, every column from that query.
 * @throws {OperationError} When the panel has no such query, or a rename names no column.
 */
function otherTable(tables: ReadonlyMap<string, Dataset>, step: Join | Append): Derived {
  const table = tables.get(step.with);
  if (!table) throw new OperationError(`no query ${step.with} in this panel`);
  const rename = step.rename ?? {};
  const other = derivedOf(step.with, table);
  for (const name of Object.keys(rename)) columnIn(other, name, step.with);
  const dimensions = table.dimensions.map((column) => ({
    ...column,
    name: rename[column.name] ?? column.name,
  }));
  return derivedOf(step.with, { ...table, dimensions });
}

/**
 * The place of a column of the other query's table.
 *
 * @param derived - That table.
 * @param name - The column.
 * @param refId - The query, for the message.
 * @returns Its index.
 * @throws {OperationError} When it has no such column.
 */
function columnIn(derived: Derived, name: string, refId: string): number {
  try {
    return columnOf(derived, name);
  } catch (error) {
    if (!(error instanceof OperationError)) throw error;
    throw new OperationError(`${refId} has ${error.message}`);
  }
}

/**
 * An origin for a column whose values come from both sides.
 *
 * @param derived - The table.
 * @param name - The column.
 * @param refId - The other query.
 * @returns The origin.
 */
function bothSides(derived: Derived, name: string, refId: string): ColumnOrigin {
  const from = derived.origins.get(name)?.from ?? [];
  return { column: name, from: [...new Set([...from, refId])] };
}

/**
 * Checks that a column has the same type on both sides.
 *
 * @param left - The column of the table.
 * @param right - The column of the other.
 * @throws {OperationError} When the types differ.
 */
function checkSameType(left: Dimension | undefined, right: Dimension | undefined): void {
  if (left && right && left.type !== right.type)
    throw new OperationError(
      `the column "${left.name}" holds ${left.type} on one side and ${right.type} on the other`,
    );
}

/**
 * Checks that a step makes no more rows than a query may return.
 *
 * @param count - The rows.
 * @throws {OperationError} Past {@link maxDerivedRows}.
 */
function checkRows(count: number): void {
  if (count > maxDerivedRows)
    throw new OperationError(
      `it makes ${count} rows, more than ${maxDerivedRows}: join on more columns, or ask for fewer rows`,
    );
}

/**
 * The key of a row, for matching.
 *
 * @param row - The row.
 * @param indexes - The key columns.
 * @returns The key as text.
 */
function keyOf(row: readonly Cell[], indexes: readonly number[]): string {
  return JSON.stringify(indexes.map((index) => row[index] ?? null));
}

/**
 * The rows of a table by key.
 *
 * @param table - The table.
 * @param indexes - The key columns.
 * @returns Each key's rows.
 */
function rowsByKey(table: Dataset, indexes: readonly number[]): Map<string, (readonly Cell[])[]> {
  const byKey = new Map<string, (readonly Cell[])[]>();
  for (const row of table.source) {
    const key = keyOf(row, indexes);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return byKey;
}

/** What a join needs to make its rows. */
interface JoinPlan {
  /** The table's key columns. */
  readonly leftKeys: readonly number[];
  /** The other's key columns. */
  readonly rightKeys: readonly number[];
  /** The other's columns that are not keys. */
  readonly rightValues: readonly number[];
}

/**
 * The rows of a join.
 *
 * @param left - The table.
 * @param right - The other's table.
 * @param plan - The columns.
 * @param outer - Whether keys only one side has are kept.
 * @returns The rows: the table's columns, then the other's that are not keys.
 */
function joinedRows(left: Dataset, right: Dataset, plan: JoinPlan, outer: boolean): Cell[][] {
  const byKey = rowsByKey(right, plan.rightKeys);
  const matched = new Set<string>();
  const valuesOf = (row: readonly Cell[]) => plan.rightValues.map((index) => row[index] ?? null);
  const empty = plan.rightValues.map(() => null);
  const rows = left.source.flatMap((row) => {
    const key = keyOf(row, plan.leftKeys);
    const matches = byKey.get(key);
    if (matches) matched.add(key);
    if (!matches) return outer ? [[...row, ...empty]] : [];
    return matches.map((other) => [...row, ...valuesOf(other)]);
  });
  if (!outer) return rows;
  const width = left.dimensions.length;
  const unmatched = [...byKey].filter(([key]) => !matched.has(key)).flatMap(([, list]) => list);
  return [
    ...rows,
    ...unmatched.map((other) => {
      const row: Cell[] = Array.from({ length: width }, () => null);
      plan.leftKeys.forEach((at, place) => {
        row[at] = other[plan.rightKeys[place] ?? -1] ?? null;
      });
      return [...row, ...valuesOf(other)];
    }),
  ];
}

/**
 * Joins the table of another query on key columns both have.
 *
 * @param derived - The table.
 * @param step - The step.
 * @param tables - The tables of the panel's queries, by refId.
 * @returns The joined table.
 * @throws {OperationError} For a missing key, keys of different types, a column both sides name,
 *   or too many rows.
 */
export function join(derived: Derived, step: Join, tables: ReadonlyMap<string, Dataset>): Derived {
  const other = otherTable(tables, step);
  const leftKeys = step.on.map((name) => columnOf(derived, name));
  const rightKeys = step.on.map((name) => columnIn(other, name, step.with));
  for (const [place, at] of leftKeys.entries())
    checkSameType(derived.table.dimensions[at], other.table.dimensions[rightKeys[place] ?? -1]);
  const rightValues = other.table.dimensions.flatMap((column, index) =>
    step.on.includes(column.name) ? [] : [index],
  );
  const added = rightValues.map((index) => other.table.dimensions[index] as Dimension);
  checkNewNames(derived, added);
  const source = joinedRows(
    derived.table,
    other.table,
    { leftKeys, rightKeys, rightValues },
    step.how === 'outer',
  );
  checkRows(source.length);
  const origins = new Map(derived.origins);
  for (const name of step.on)
    if (step.how === 'outer') origins.set(name, bothSides(derived, name, step.with));
  for (const column of added) origins.set(column.name, { column: column.name, from: [step.with] });
  return { table: { dimensions: [...derived.table.dimensions, ...added], source }, origins };
}

/**
 * Checks that the columns a join adds are new to the table.
 *
 * @param derived - The table.
 * @param added - The columns.
 * @throws {OperationError} Naming the first column both sides have.
 */
function checkNewNames(derived: Derived, added: readonly Dimension[]): void {
  const clash = added.find((column) => derived.origins.has(column.name));
  if (clash)
    throw new OperationError(
      `both tables have a column "${clash.name}": rename the other's with "rename", or join on it`,
    );
}

/**
 * Adds the rows of another query's table under the table's, matching columns by name. A column
 * one side lacks has no value in that side's rows.
 *
 * @param derived - The table.
 * @param step - The step.
 * @param tables - The tables of the panel's queries, by refId.
 * @returns The table with both sides' rows.
 * @throws {OperationError} For a column of different types on the two sides, or too many rows.
 */
export function append(
  derived: Derived,
  step: Append,
  tables: ReadonlyMap<string, Dataset>,
): Derived {
  const other = otherTable(tables, step);
  const { dimensions } = derived.table;
  for (const column of other.table.dimensions)
    checkSameType(
      dimensions.find((each) => each.name === column.name),
      column,
    );
  const added = other.table.dimensions.filter((column) => !derived.origins.has(column.name));
  const columns = [...dimensions, ...added];
  const placeIn = columns.map((column) =>
    other.table.dimensions.findIndex((each) => each.name === column.name),
  );
  const empty = added.map(() => null);
  const source = [
    ...derived.table.source.map((row) => [...row, ...empty]),
    ...other.table.source.map((row) => placeIn.map((at) => (at < 0 ? null : (row[at] ?? null)))),
  ];
  checkRows(source.length);
  return { table: { dimensions: columns, source }, origins: appendedOrigins(derived, other, step) };
}

/**
 * The origins of an append's columns: a column both sides have comes from both.
 *
 * @param derived - The table.
 * @param other - The other's table.
 * @param step - The step.
 * @returns The origins, by column.
 */
function appendedOrigins(
  derived: Derived,
  other: Derived,
  step: Append,
): Map<string, ColumnOrigin> {
  const origins = new Map(derived.origins);
  for (const { name } of other.table.dimensions)
    origins.set(
      name,
      origins.has(name) ? bothSides(derived, name, step.with) : { column: name, from: [step.with] },
    );
  return origins;
}

/**
 * Runs table operations on datasets. Pure: the server calls it with the tables of a panel's
 * queries. A step that cannot run throws an {@link OperationError} that names the step and why.
 */
import type { Operation } from '../spec/operations.ts';
import type { Dataset } from './contract.ts';
import { calculate } from './operation-calculate.ts';
import { append, join } from './operation-join.ts';
import { concat, sort } from './operation-order.ts';
import { pivot } from './operation-pivot.ts';
import { type ColumnOrigin, type Derived, derivedOf, OperationError } from './operation-table.ts';

export { type ColumnOrigin, OperationError } from './operation-table.ts';

/** What the operations end with: the table, and where each column comes from, in order. */
export interface OperationsResult {
  /** The table. */
  readonly table: Dataset;
  /** The origin of each column, in the table's order. */
  readonly origins: readonly ColumnOrigin[];
}

/**
 * Runs one step.
 *
 * @param derived - The table so far.
 * @param step - The step.
 * @param tables - The tables of the panel's queries, by refId.
 * @returns The table after it.
 */
function runStep(derived: Derived, step: Operation, tables: ReadonlyMap<string, Dataset>): Derived {
  switch (step.op) {
    case 'calculate':
      return calculate(derived, step);
    case 'join':
      return join(derived, step, tables);
    case 'append':
      return append(derived, step, tables);
    case 'pivot':
      return pivot(derived, step);
    case 'concat':
      return concat(derived, step);
    case 'sort':
      return sort(derived, step);
  }
}

/**
 * Runs a panel's operations in order, from the table of its first query.
 *
 * @param base - The first query: its refId and its table.
 * @param base.refId - Its refId.
 * @param base.table - Its table.
 * @param operations - The steps.
 * @param tables - The tables of the panel's other queries, by refId, for joins and appends.
 * @returns The table they end with and the origin of each column.
 * @throws {OperationError} For a step that cannot run, named by its place and kind.
 */
export function runOperations(
  base: { readonly refId: string; readonly table: Dataset },
  operations: readonly Operation[],
  tables: ReadonlyMap<string, Dataset> = new Map(),
): OperationsResult {
  let derived = derivedOf(base.refId, base.table);
  for (const [index, step] of operations.entries()) {
    try {
      derived = runStep(derived, step, tables);
    } catch (error) {
      if (!(error instanceof OperationError)) throw error;
      throw new OperationError(`operations[${index}] (${step.op}): ${error.message}.`);
    }
  }
  const { table, origins } = derived;
  const ordered = table.dimensions.map(
    ({ name }) => origins.get(name) ?? { column: name, from: [base.refId] },
  );
  return { table, origins: ordered };
}

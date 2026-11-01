/**
 * The `calculate` operation: a number column from two number columns of the table.
 */
import type { Operation } from '../spec/operations.ts';
import type { Cell } from './contract.ts';
import { type Derived, numberColumn, sourcesOf, withColumn } from './operation-table.ts';

/** A calculate step. */
type Calculate = Extract<Operation, { op: 'calculate' }>;

/** The functions of `calculate`, from the two numbers to the result. */
const calculations: Readonly<Record<Calculate['fn'], (a: number, b: number) => number>> = {
  ratio: (a, b) => (b === 0 ? 0 : a / b),
  complement: (a, b) => (b === 0 ? 0 : 1 - a / b),
  difference: (a, b) => a - b,
  sum: (a, b) => a + b,
  product: (a, b) => a * b,
};

/**
 * Adds a number column computed from two others. A missing value, or a result that is not a
 * finite number, gives a missing value. The column comes from the queries of both.
 *
 * @param derived - The table.
 * @param step - The step.
 * @returns The table with the new column last, or in place of a column of the same name.
 * @throws {OperationError} When a column is missing or does not hold numbers.
 */
export function calculate(derived: Derived, step: Calculate): Derived {
  const [a, b] = step.of.slice(0, 2).map((name) => numberColumn(derived, name));
  const compute = calculations[step.fn];
  const resultOf = (row: readonly Cell[]): Cell => {
    const first = row[a ?? -1];
    const second = row[b ?? -1];
    if (typeof first !== 'number' || typeof second !== 'number') return null;
    const result = compute(first, second);
    return Number.isFinite(result) ? result : null;
  };
  const values = derived.table.source.map(resultOf);
  return withColumn(
    derived,
    { name: step.name, type: 'number' },
    values,
    sourcesOf(derived, step.of),
  );
}

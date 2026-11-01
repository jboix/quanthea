/**
 * Table operations: a closed set of named steps the server runs on a panel's query results, on
 * any connector. They start from the table of the panel's first query, run in order, and the table
 * they end with takes that query's place, so the view reads it by the same refId. A join or an
 * append reads another query of the panel by its refId, on any connector. No expression language:
 * each step is one of a few fixed operations.
 */
import { z } from 'zod';
import { refIdSchema } from './names.ts';

/** Validates a column name of a result table. */
const columnSchema = z.string().min(1).max(200);

/**
 * What `calculate` computes from two number columns `a` and `b`: `ratio` is a / b, zero when b is
 * zero; `complement` is 1 - a / b, zero when b is zero; `difference` a - b; `sum` a + b;
 * `product` a × b. A missing value on either side gives a missing value.
 */
export const calculateFunctions = ['ratio', 'complement', 'difference', 'sum', 'product'] as const;

/** A new number column computed from two columns of the table. */
const calculateSchema = z.strictObject({
  op: z.literal('calculate'),
  name: columnSchema,
  fn: z.enum(calculateFunctions),
  // Two columns, a then b. An array, not a tuple: Gemini's tool schemas take no tuples.
  of: z.array(columnSchema).min(2).max(2),
});

/** New names for the columns of the other query's table, applied before a join or an append. */
const renameSchema = z.record(columnSchema, columnSchema).optional();

/**
 * The rows of another query of the panel joined to the table on key columns both have: `inner`
 * keeps the keys both have, `outer` every key of either, with no value where a side has none.
 */
const joinSchema = z.strictObject({
  op: z.literal('join'),
  with: refIdSchema,
  on: z.array(columnSchema).min(1).max(3),
  how: z.enum(['inner', 'outer']).default('outer'),
  rename: renameSchema,
});

/** The rows of another query of the panel added under the table's, columns matched by name. */
const appendSchema = z.strictObject({
  op: z.literal('append'),
  with: refIdSchema,
  rename: renameSchema,
});

/**
 * A row per value of `rows`, a column per value of `columns`, and in each cell the sum of the
 * number column `value`, zero where a row has none. The new columns come in natural order (`2.10`
 * after `2.9`); a table shows them with its `rest` style.
 */
const pivotSchema = z.strictObject({
  op: z.literal('pivot'),
  rows: columnSchema,
  columns: columnSchema,
  value: columnSchema,
});

/** A text column joined from two to four columns with a separator; a missing value is left out. */
const concatSchema = z.strictObject({
  op: z.literal('concat'),
  name: columnSchema,
  columns: z.array(columnSchema).min(2).max(4),
  separator: z.string().max(10).default(' '),
});

/**
 * The rows ordered by a column: numbers and times by value, text in natural order (`2.10` after
 * `2.9`), missing values last.
 */
const sortSchema = z.strictObject({
  op: z.literal('sort'),
  by: columnSchema,
  descending: z.boolean().default(false),
});

/** Validates one table operation. */
export const operationSchema = z.discriminatedUnion('op', [
  calculateSchema,
  joinSchema,
  appendSchema,
  pivotSchema,
  concatSchema,
  sortSchema,
]);

/** One table operation. */
export type Operation = z.infer<typeof operationSchema>;

/** Validates a panel's table operations, run in order. */
export const operationsSchema = z.array(operationSchema).min(1).max(8);
